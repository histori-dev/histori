import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { api, type SessionDetail, type HookEvent } from "../api";
import { TopBar } from "../components/Chrome";

const KIND_COLOR: Record<string, string> = {
  SessionStart: "text-sage",
  UserPromptSubmit: "text-warm",
  PreToolUse: "text-faint",
  PostToolUse: "text-accent",
  GitCommit: "text-warm",
  Stop: "text-faint",
  SubagentStop: "text-faint",
  Notification: "text-faint",
  PreCompact: "text-warm",
};

// PreToolUse duplicates PostToolUse for every call; Stop/Notification carry
// no information a human scans for. Hidden unless "all events" is on.
const NOISE = new Set(["PreToolUse", "Stop", "SubagentStop", "Notification", "SessionStart"]);

function fmtDate(s: string) {
  return new Date(s).toLocaleString();
}

function baseName(p: string) {
  return p.split(/[/\\]/).pop() ?? p;
}

function countLines(s: string): number {
  return s ? s.split("\n").length : 0;
}

type Diff = { path: string; old: string; new: string };

/** Extract the actual change an Edit/Write tool made, if the payload has one. */
function extractDiff(e: HookEvent): Diff | null {
  if (e.kind !== "PostToolUse") return null;
  const input = e.payload["tool_input"] as Record<string, unknown> | undefined;
  if (!input) return null;
  const path = (input["file_path"] ?? input["path"]) as string | undefined;
  if (!path) return null;

  const oldStr = (input["old_string"] ?? input["old_str"]) as string | undefined;
  const newStr = (input["new_string"] ?? input["new_str"]) as string | undefined;
  if (oldStr !== undefined || newStr !== undefined) {
    return { path, old: oldStr ?? "", new: newStr ?? "" };
  }
  const content = input["content"] as string | undefined;
  if (content !== undefined) return { path, old: "", new: content };
  return null;
}

function payloadPreview(e: HookEvent): string {
  const p = e.payload;
  if (typeof p["prompt"] === "string") return p["prompt"] as string;
  if (e.kind === "GitCommit" && typeof p["message"] === "string") return p["message"] as string;
  if (typeof p["tool_name"] === "string") {
    const input = p["tool_input"] as Record<string, unknown> | undefined;
    const target =
      (input?.["file_path"] as string) ??
      (input?.["path"] as string) ??
      (input?.["command"] as string) ??
      "";
    return target
      ? `${p["tool_name"]} — ${baseName(String(target).slice(0, 120))}`
      : (p["tool_name"] as string);
  }
  return JSON.stringify(p);
}

// A turn = one user prompt and everything the agent did in response.
type Turn = { n: number; prompt: string | null; events: HookEvent[] };

function buildTurns(events: HookEvent[]): Turn[] {
  const turns: Turn[] = [];
  let cur: Turn = { n: 0, prompt: null, events: [] };
  let promptCount = 0;
  for (const e of events) {
    if (e.kind === "UserPromptSubmit") {
      if (cur.prompt !== null || cur.events.length) turns.push(cur);
      promptCount += 1;
      cur = { n: promptCount, prompt: String(e.payload["prompt"] ?? ""), events: [] };
    } else {
      cur.events.push(e);
    }
  }
  if (cur.prompt !== null || cur.events.length) turns.push(cur);
  return turns;
}

function turnStats(t: Turn): { files: number; added: number; removed: number } {
  const paths = new Set<string>();
  let added = 0;
  let removed = 0;
  for (const e of t.events) {
    const d = extractDiff(e);
    if (!d) continue;
    paths.add(d.path);
    added += countLines(d.new);
    removed += countLines(d.old);
  }
  return { files: paths.size, added, removed };
}

const SHELL_TOOLS = new Set(["Bash", "PowerShell", "Shell"]);
const READ_TOOLS = new Set(["Read", "Glob", "Grep"]);
const FETCH_TOOLS = new Set(["WebFetch", "WebSearch"]);

/** A human-readable line of what the agent actually did this turn. */
function turnSummary(t: Turn): string {
  const wrote = new Set<string>();
  const edited = new Set<string>();
  let commands = 0;
  let reads = 0;
  let fetches = 0;
  let commits = 0;

  for (const e of t.events) {
    if (e.kind === "GitCommit") {
      commits += 1;
      continue;
    }
    if (e.kind !== "PostToolUse") continue;
    const tool = String(e.payload["tool_name"] ?? "");
    const input = e.payload["tool_input"] as Record<string, unknown> | undefined;
    const path = (input?.["file_path"] ?? input?.["path"]) as string | undefined;

    if (path && (input?.["old_string"] !== undefined || input?.["old_str"] !== undefined)) {
      edited.add(baseName(path));
    } else if (path && input?.["content"] !== undefined) {
      wrote.add(baseName(path));
    } else if (SHELL_TOOLS.has(tool)) {
      commands += 1;
    } else if (READ_TOOLS.has(tool)) {
      reads += 1;
    } else if (FETCH_TOOLS.has(tool)) {
      fetches += 1;
    }
  }

  const listFiles = (s: Set<string>) => {
    const arr = [...s];
    return arr.length <= 3
      ? arr.join(", ")
      : `${arr.slice(0, 3).join(", ")} +${arr.length - 3} more`;
  };

  const parts: string[] = [];
  if (wrote.size) parts.push(`wrote ${listFiles(wrote)}`);
  if (edited.size) parts.push(`edited ${listFiles(edited)}`);
  if (commands) parts.push(`ran ${commands} command${commands === 1 ? "" : "s"}`);
  if (fetches) parts.push(`fetched ${fetches} page${fetches === 1 ? "" : "s"}`);
  if (reads && !wrote.size && !edited.size)
    parts.push(`read ${reads} file${reads === 1 ? "" : "s"}`);
  if (commits) parts.push(`${commits} git commit${commits === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [fileFilter, setFileFilter] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api
      .session(id)
      .then(setData)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [id]);

  const turns = useMemo(() => (data ? buildTurns(data.events) : []), [data]);

  // One row per file, churn-sorted — not one row per individual edit
  const fileAgg = useMemo(() => {
    if (!data) return [];
    const byPath = new Map<string, { added: number; removed: number; edits: number }>();
    for (const f of data.files) {
      const cur = byPath.get(f.path) ?? { added: 0, removed: 0, edits: 0 };
      cur.added += f.linesAdded;
      cur.removed += f.linesRemoved;
      cur.edits += 1;
      byPath.set(f.path, cur);
    }
    return [...byPath.entries()].sort(
      (a, b) => b[1].added + b[1].removed - (a[1].added + a[1].removed),
    );
  }, [data]);

  function visibleEvents(t: Turn): HookEvent[] {
    let evs = showAll ? t.events : t.events.filter((e) => !NOISE.has(e.kind));
    if (fileFilter) evs = evs.filter((e) => extractDiff(e)?.path === fileFilter);
    return evs;
  }

  const shownTurns = fileFilter ? turns.filter((t) => visibleEvents(t).length > 0) : turns;

  return (
    <div className="min-h-screen">
      <TopBar
        active="sessions"
        right={data?.session.model && <span>{data.session.model}</span>}
      />

      <main className="px-6 py-6 max-w-6xl mx-auto">
        <Link
          to="/"
          className="text-xs text-muted hover:text-ink transition-colors inline-block mb-4"
        >
          ← All sessions
        </Link>

        {loading && <p className="text-muted text-sm">Loading...</p>}
        {error && <p className="text-neg-strong text-sm">{error}</p>}

        {data && (
          <>
            {/* Session header */}
            <div className="mb-8">
              <h1 className="text-ink font-semibold text-base">{data.session.cwd}</h1>
              <div className="flex flex-wrap gap-4 mt-2 text-sm text-muted">
                <span>{fmtDate(data.session.startedAt)}</span>
                {data.session.repo && (
                  <span>
                    {data.session.repo}
                    {data.session.branch ? `@${data.session.branch}` : ""}
                  </span>
                )}
                {data.session.model && <span className="text-faint">{data.session.model}</span>}
              </div>
              <div className="flex gap-4 mt-2 text-sm">
                {fileAgg.length > 0 && (
                  <span className="font-mono text-xs pt-0.5">
                    <span className="text-muted font-sans">{fileAgg.length} files </span>
                    <span className="text-pos">
                      +{fileAgg.reduce((s, [, v]) => s + v.added, 0)}
                    </span>
                    <span className="text-faint">/</span>
                    <span className="text-neg">
                      -{fileAgg.reduce((s, [, v]) => s + v.removed, 0)}
                    </span>
                  </span>
                )}
                <span className="text-muted">
                  {(data.session.inputTokens + data.session.outputTokens).toLocaleString()} tokens
                </span>
                <span
                  className={data.session.costUsd > 1 ? "text-warm font-medium" : "text-accent"}
                  title="API-equivalent value — on Pro/Max you pay a flat subscription, not this amount"
                >
                  ${data.session.costUsd.toFixed(4)} <span className="text-faint">API equiv.</span>
                </span>
              </div>
            </div>

            <div className="grid grid-cols-[1fr_340px] gap-8">
              {/* Timeline grouped by prompt */}
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xs text-muted uppercase tracking-wider">
                    Timeline — {turns.filter((t) => t.prompt !== null).length} prompts
                  </h2>
                  <div className="flex items-center gap-3">
                    {fileFilter && (
                      <button
                        onClick={() => setFileFilter(null)}
                        className="text-xs bg-sage-tint text-accent rounded-full px-2.5 py-0.5 hover:bg-sage/40 transition-colors"
                      >
                        {baseName(fileFilter)} ✕
                      </button>
                    )}
                    <button
                      onClick={() => setShowAll(!showAll)}
                      className="text-xs text-faint hover:text-muted transition-colors"
                    >
                      {showAll ? "hide noise" : "all events"}
                    </button>
                  </div>
                </div>

                <div className="space-y-6">
                  {shownTurns.map((t) => {
                    const stats = turnStats(t);
                    const evs = visibleEvents(t);
                    const summary = turnSummary(t);
                    return (
                      <div
                        key={t.n}
                        className="border border-line rounded-lg bg-inset shadow-sm overflow-hidden"
                      >
                        {/* Prompt header — the "why" of every change below it */}
                        <div className="px-4 py-3 bg-surface border-b border-line">
                          {t.prompt === null ? (
                            <span className="text-faint text-xs">session start</span>
                          ) : (
                            <div className="flex items-start gap-2">
                              <span className="text-warm text-xs font-mono shrink-0 pt-0.5">
                                ❯ {t.n}
                              </span>
                              <p className="text-ink text-sm leading-relaxed">
                                {t.prompt.length > 280 ? `${t.prompt.slice(0, 280)}…` : t.prompt}
                              </p>
                            </div>
                          )}
                          {(summary || stats.files > 0) && (
                            <p className="text-xs mt-1.5 ml-6">
                              {summary && <span className="text-muted">{summary}</span>}
                              {stats.files > 0 && (
                                <span className="font-mono ml-2">
                                  <span className="text-pos">+{stats.added}</span>
                                  <span className="text-faint">/</span>
                                  <span className="text-neg">-{stats.removed}</span>
                                </span>
                              )}
                            </p>
                          )}
                        </div>

                        {/* Events of this turn */}
                        <div className="px-4">
                          {evs.length === 0 && (
                            <p className="text-faint text-xs py-2">no file changes this turn</p>
                          )}
                          {evs.map((e) => {
                            const diff = extractDiff(e);
                            const expanded = fileFilter !== null || expandedEvent === e.id;
                            return (
                              <div key={e.id} className="border-b border-line last:border-0">
                                <div
                                  className={`flex gap-3 py-2 items-start ${diff ? "cursor-pointer hover:bg-surface/70" : ""}`}
                                  onClick={() =>
                                    diff && !fileFilter && setExpandedEvent(expanded ? null : e.id)
                                  }
                                >
                                  <span
                                    className={`text-xs font-mono shrink-0 w-28 pt-0.5 ${KIND_COLOR[e.kind] ?? "text-faint"}`}
                                  >
                                    {e.kind === "PostToolUse" ? "ToolUse" : e.kind}
                                  </span>
                                  <span className="text-muted text-xs leading-relaxed flex-1">
                                    {payloadPreview(e).slice(0, 160)}
                                  </span>
                                  {diff && !fileFilter && (
                                    <span className="text-faint text-xs shrink-0">
                                      {expanded ? "▲" : "diff ▼"}
                                    </span>
                                  )}
                                </div>

                                {expanded && diff && (
                                  <div className="mb-3 rounded-lg border border-line overflow-hidden text-xs font-mono">
                                    <div className="px-3 py-1.5 bg-surface text-muted border-b border-line">
                                      {diff.path}
                                    </div>
                                    {diff.old && (
                                      <pre className="px-3 py-2 bg-neg-tint text-neg-strong whitespace-pre-wrap break-all max-h-64 overflow-auto border-b border-line">
                                        {diff.old}
                                      </pre>
                                    )}
                                    <pre className="px-3 py-2 bg-sage-tint text-accent-strong whitespace-pre-wrap break-all max-h-64 overflow-auto">
                                      {diff.new}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Files changed — click one to see all its edits */}
              <section>
                <h2 className="text-xs text-muted uppercase tracking-wider mb-3">
                  Files changed ({fileAgg.length})
                  <span className="normal-case tracking-normal text-faint ml-2">
                    — click to trace edits
                  </span>
                </h2>
                {fileAgg.length === 0 ? (
                  <p className="text-faint text-xs">No files recorded</p>
                ) : (
                  <div className="border border-line rounded-lg bg-inset shadow-sm px-3 py-1">
                    {fileAgg.map(([path, agg]) => (
                      <div
                        key={path}
                        onClick={() => setFileFilter(fileFilter === path ? null : path)}
                        className={`py-2 border-b border-line last:border-0 cursor-pointer px-2 -mx-2 transition-colors ${
                          fileFilter === path ? "bg-sage-tint" : "hover:bg-surface/70"
                        }`}
                      >
                        <div className="flex justify-between items-center">
                          <span className="text-ink text-xs font-medium truncate mr-2" title={path}>
                            {baseName(path)}
                          </span>
                          <span className="text-xs shrink-0 font-mono">
                            <span className="text-pos">+{agg.added}</span>
                            <span className="text-faint mx-0.5">/</span>
                            <span className="text-neg">-{agg.removed}</span>
                          </span>
                        </div>
                        <div className="flex justify-between text-[11px] text-faint mt-0.5">
                          <span className="truncate mr-2">{path}</span>
                          <span className="shrink-0">
                            {agg.edits} edit{agg.edits === 1 ? "" : "s"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
