import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { api, type SessionDetail, type HookEvent } from "../api";

const KIND_COLOR: Record<string, string> = {
  SessionStart: "text-blue-400",
  UserPromptSubmit: "text-violet-400",
  PreToolUse: "text-yellow-400",
  PostToolUse: "text-emerald-400",
  GitCommit: "text-orange-400",
  Stop: "text-zinc-500",
  SubagentStop: "text-zinc-500",
  Notification: "text-sky-400",
  PreCompact: "text-orange-400",
};

function fmtDate(s: string) {
  return new Date(s).toLocaleString();
}

function baseName(p: string) {
  return p.split(/[/\\]/).pop() ?? p;
}

type Diff = { path: string; old: string; new: string } | null;

/** Extract the actual change an Edit/Write tool made, if the payload has one. */
function extractDiff(e: HookEvent): Diff {
  if (e.kind !== "PostToolUse" && e.kind !== "PreToolUse") return null;
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
  if (content !== undefined) {
    return { path, old: "", new: content };
  }
  return null;
}

function payloadPreview(e: HookEvent): string {
  const p = e.payload;
  if (typeof p["prompt"] === "string") return p["prompt"] as string;
  if (typeof p["message"] === "string" && e.kind === "GitCommit") {
    return `${p["message"]}`;
  }
  if (typeof p["tool_name"] === "string") {
    const input = p["tool_input"] as Record<string, unknown> | undefined;
    const target =
      (input?.["file_path"] as string) ??
      (input?.["path"] as string) ??
      (input?.["command"] as string) ??
      "";
    return target ? `${p["tool_name"]} — ${baseName(String(target).slice(0, 120))}` : (p["tool_name"] as string);
  }
  return JSON.stringify(p);
}

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api
      .session(id)
      .then(setData)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [id]);

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

  return (
    <div className="min-h-screen">
      {/* Nav */}
      <header className="border-b border-zinc-800 px-6 py-4">
        <Link to="/" className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors">
          ← Sessions
        </Link>
      </header>

      <main className="px-6 py-6 max-w-6xl mx-auto">
        {loading && <p className="text-zinc-500 text-sm">Loading...</p>}
        {error && <p className="text-red-400 text-sm">{error}</p>}

        {data && (
          <>
            {/* Session header */}
            <div className="mb-8">
              <h1 className="text-zinc-100 font-medium text-base">{data.session.cwd}</h1>
              <div className="flex flex-wrap gap-4 mt-2 text-sm text-zinc-500">
                <span>{fmtDate(data.session.startedAt)}</span>
                {data.session.repo && (
                  <span>
                    {data.session.repo}
                    {data.session.branch ? `@${data.session.branch}` : ""}
                  </span>
                )}
                {data.session.model && <span className="text-zinc-600">{data.session.model}</span>}
              </div>
              <div className="flex gap-4 mt-2 text-sm">
                {fileAgg.length > 0 && (
                  <span className="font-mono text-xs pt-0.5">
                    <span className="text-zinc-400 font-sans">{fileAgg.length} files </span>
                    <span className="text-emerald-500">
                      +{fileAgg.reduce((s, [, v]) => s + v.added, 0)}
                    </span>
                    <span className="text-zinc-700">/</span>
                    <span className="text-red-500">
                      -{fileAgg.reduce((s, [, v]) => s + v.removed, 0)}
                    </span>
                  </span>
                )}
                <span className="text-zinc-400">
                  {(data.session.inputTokens + data.session.outputTokens).toLocaleString()} tokens
                </span>
                <span
                  className={
                    data.session.costUsd > 1 ? "text-amber-400" : "text-emerald-400"
                  }
                >
                  ${data.session.costUsd.toFixed(4)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-[1fr_340px] gap-8">
              {/* Events timeline */}
              <section>
                <h2 className="text-xs text-zinc-500 uppercase tracking-wider mb-3">
                  Events ({data.events.length})
                  <span className="normal-case tracking-normal text-zinc-600 ml-2">
                    — click an edit to see the diff
                  </span>
                </h2>
                <div className="space-y-0">
                  {data.events.map((e) => {
                    const diff = extractDiff(e);
                    const expanded = expandedEvent === e.id;
                    return (
                      <div key={e.id} className="border-b border-zinc-800/40">
                        <div
                          className={`flex gap-3 py-2 items-start ${diff ? "cursor-pointer hover:bg-zinc-900/50" : ""}`}
                          onClick={() => diff && setExpandedEvent(expanded ? null : e.id)}
                        >
                          <span
                            className={`text-xs font-mono shrink-0 w-36 pt-0.5 ${KIND_COLOR[e.kind] ?? "text-zinc-500"}`}
                          >
                            {e.kind}
                          </span>
                          <span className="text-zinc-500 text-xs leading-relaxed flex-1">
                            {payloadPreview(e).slice(0, 160)}
                          </span>
                          {diff && (
                            <span className="text-zinc-600 text-xs shrink-0">
                              {expanded ? "▲" : "diff ▼"}
                            </span>
                          )}
                        </div>

                        {expanded && diff && (
                          <div className="mb-3 ml-[9.75rem] rounded border border-zinc-800 overflow-hidden text-xs font-mono">
                            <div className="px-3 py-1.5 bg-zinc-900 text-zinc-400 border-b border-zinc-800">
                              {diff.path}
                            </div>
                            {diff.old && (
                              <pre className="px-3 py-2 bg-red-950/30 text-red-300/90 whitespace-pre-wrap break-all max-h-64 overflow-auto border-b border-zinc-800">
                                {diff.old}
                              </pre>
                            )}
                            <pre className="px-3 py-2 bg-emerald-950/30 text-emerald-300/90 whitespace-pre-wrap break-all max-h-64 overflow-auto">
                              {diff.new}
                            </pre>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Files changed */}
              <section>
                <h2 className="text-xs text-zinc-500 uppercase tracking-wider mb-3">
                  Files changed ({fileAgg.length})
                </h2>
                {fileAgg.length === 0 ? (
                  <p className="text-zinc-700 text-xs">No files recorded</p>
                ) : (
                  <div className="space-y-0">
                    {fileAgg.map(([path, agg]) => (
                      <div
                        key={path}
                        className="py-2 border-b border-zinc-800/40"
                      >
                        <div className="flex justify-between items-center">
                          <span className="text-zinc-300 text-xs truncate mr-2" title={path}>
                            {baseName(path)}
                          </span>
                          <span className="text-xs shrink-0 font-mono">
                            <span className="text-emerald-500">+{agg.added}</span>
                            <span className="text-zinc-700 mx-0.5">/</span>
                            <span className="text-red-500">-{agg.removed}</span>
                          </span>
                        </div>
                        <div className="flex justify-between text-[11px] text-zinc-600 mt-0.5">
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
