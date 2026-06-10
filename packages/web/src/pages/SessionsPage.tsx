import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { api, type Session } from "../api";

type Range = "day" | "week" | "month" | "all";

const RANGES: { key: Range; label: string }[] = [
  { key: "day", label: "Today" },
  { key: "week", label: "7 days" },
  { key: "month", label: "30 days" },
  { key: "all", label: "All time" },
];

function fmtDate(s: string) {
  return new Date(s).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function shortDir(cwd: string) {
  return cwd.replace(/\\/g, "/").split("/").slice(-2).join("/");
}

function shortModel(model: string | null) {
  if (!model) return "—";
  return model.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}

/** Project identity: repo if known, else the last path segment of cwd. */
function projectOf(s: Session): string {
  if (s.repo) return s.repo;
  const seg = s.cwd.replace(/\\/g, "/").split("/").filter(Boolean);
  return seg[seg.length - 1] ?? s.cwd;
}

function rangeStart(range: Range): number | null {
  const now = new Date();
  if (range === "day") return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (range === "week") return now.getTime() - 7 * 86_400_000;
  if (range === "month") return now.getTime() - 30 * 86_400_000;
  return null;
}

type Bucket = { label: string; added: number; removed: number; sessions: number };

/** Bucket churn over the selected range — hourly for today, daily otherwise. */
function buildBuckets(sessions: Session[], range: Range): Bucket[] {
  const now = new Date();
  if (range === "day") {
    const buckets: Bucket[] = Array.from({ length: 24 }, (_, h) => ({
      label: `${h}:00`,
      added: 0,
      removed: 0,
      sessions: 0,
    }));
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    for (const s of sessions) {
      const t = new Date(s.startedAt).getTime();
      if (t < dayStart) continue;
      const b = buckets[new Date(t).getHours()];
      if (!b) continue;
      b.added += s.linesAdded;
      b.removed += s.linesRemoved;
      b.sessions += 1;
    }
    return buckets;
  }

  const days = range === "week" ? 7 : range === "month" ? 30 : 60;
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const buckets: Bucket[] = Array.from({ length: days }, (_, i) => {
    const d = new Date(todayStart - (days - 1 - i) * 86_400_000);
    return {
      label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      added: 0,
      removed: 0,
      sessions: 0,
    };
  });
  for (const s of sessions) {
    const t = new Date(s.startedAt).getTime();
    const idx = days - 1 - Math.floor((todayStart + 86_400_000 - 1 - t) / 86_400_000);
    const b = buckets[idx];
    if (!b) continue;
    b.added += s.linesAdded;
    b.removed += s.linesRemoved;
    b.sessions += 1;
  }
  return buckets;
}

function ChurnChart({ buckets }: { buckets: Bucket[] }) {
  const max = Math.max(1, ...buckets.map((b) => Math.max(b.added, b.removed)));
  const labelEvery = Math.ceil(buckets.length / 8);
  return (
    <div>
      <div className="flex items-end gap-px h-28">
        {buckets.map((b, i) => (
          <div
            key={i}
            className="flex-1 flex flex-col justify-end group relative"
            title={`${b.label} — ${b.sessions} session${b.sessions === 1 ? "" : "s"}, +${b.added}/-${b.removed} lines`}
          >
            <div
              className="w-full rounded-t-sm bg-emerald-500/80 group-hover:bg-emerald-400 transition-colors"
              style={{ height: `${(b.added / max) * 100}%`, minHeight: b.added ? "2px" : "0" }}
            />
          </div>
        ))}
      </div>
      <div className="border-t border-zinc-700/80" />
      <div className="flex items-start gap-px h-16">
        {buckets.map((b, i) => (
          <div
            key={i}
            className="flex-1 group relative"
            title={`${b.label} — ${b.sessions} session${b.sessions === 1 ? "" : "s"}, +${b.added}/-${b.removed} lines`}
          >
            <div
              className="w-full rounded-b-sm bg-red-500/70 group-hover:bg-red-400 transition-colors"
              style={{ height: `${(b.removed / max) * 100}%`, minHeight: b.removed ? "2px" : "0" }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-px mt-1">
        {buckets.map((b, i) => (
          <span key={i} className="flex-1 text-center text-[10px] text-zinc-600 truncate">
            {i % labelEvery === 0 ? b.label : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="border border-zinc-800 rounded-xl bg-zinc-900/40 px-4 py-3">
      <p className={`text-xl font-semibold tracking-tight ${accent ?? "text-zinc-100"}`}>{value}</p>
      <p className="text-xs text-zinc-500 mt-0.5">{label}</p>
    </div>
  );
}

export default function SessionsPage() {
  const [allSessions, setAllSessions] = useState<Session[]>([]);
  const [results, setResults] = useState<Session[] | null>(null);
  const [query, setQuery] = useState("");
  const [range, setRange] = useState<Range>("day");
  const [project, setProject] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api
      .sessions()
      .then(setAllSessions)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  function onSearch(q: string) {
    setQuery(q);
    if (debounce.current) clearTimeout(debounce.current);
    if (!q.trim()) {
      setResults(null);
      return;
    }
    debounce.current = setTimeout(() => {
      setSearching(true);
      api
        .search(q.trim())
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
  }

  const projects = useMemo(() => {
    const set = new Set(allSessions.map(projectOf));
    return [...set].sort();
  }, [allSessions]);

  const filtered = useMemo(() => {
    const base = results ?? allSessions;
    const start = rangeStart(range);
    return base.filter((s) => {
      if (start !== null && new Date(s.startedAt).getTime() < start) return false;
      if (project !== "all" && projectOf(s) !== project) return false;
      return true;
    });
  }, [results, allSessions, range, project]);

  const buckets = useMemo(() => buildBuckets(filtered, range), [filtered, range]);

  const stats = useMemo(
    () => ({
      sessions: filtered.length,
      files: filtered.reduce((s, r) => s + r.filesChanged, 0),
      added: filtered.reduce((s, r) => s + r.linesAdded, 0),
      removed: filtered.reduce((s, r) => s + r.linesRemoved, 0),
      tokens: filtered.reduce((s, r) => s + r.inputTokens + r.outputTokens, 0),
      cost: filtered.reduce((s, r) => s + r.costUsd, 0),
    }),
    [filtered],
  );

  const hasChurn = buckets.some((b) => b.added || b.removed);

  return (
    <div className="min-h-screen">
      {/* Nav */}
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center gap-4">
        <span className="font-semibold tracking-tight text-zinc-100 shrink-0">histori</span>

        <nav className="flex gap-4 text-sm shrink-0">
          <span className="text-zinc-300">Sessions</span>
          <Link to="/memories" className="text-zinc-500 hover:text-zinc-300 transition-colors">
            Memories
          </Link>
          <Link to="/rules" className="text-zinc-500 hover:text-zinc-300 transition-colors">
            Rules
          </Link>
        </nav>

        <input
          type="search"
          value={query}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search sessions…"
          className="flex-1 max-w-sm bg-zinc-900 border border-zinc-700 rounded-md px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-500 transition-colors"
        />
        {searching && <span className="text-zinc-600 text-sm">Searching…</span>}
      </header>

      <main className="px-6 py-6 max-w-5xl mx-auto">
        {loading && <p className="text-zinc-500 text-sm">Loading...</p>}
        {error && <p className="text-red-400 text-sm">{error}</p>}

        {!loading && !error && (
          <>
            {/* Filters */}
            <div className="flex items-center gap-3 mb-6 flex-wrap">
              <div className="flex bg-zinc-900 border border-zinc-800 rounded-full p-0.5">
                {RANGES.map((r) => (
                  <button
                    key={r.key}
                    onClick={() => setRange(r.key)}
                    className={`px-3.5 py-1 text-xs rounded-full transition-colors ${
                      range === r.key
                        ? "bg-zinc-100 text-zinc-900 font-medium"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>

              <select
                value={project}
                onChange={(e) => setProject(e.target.value)}
                className="bg-zinc-900 border border-zinc-800 rounded-full px-3.5 py-1.5 text-xs text-zinc-300 outline-none focus:border-zinc-600 cursor-pointer"
              >
                <option value="all">All projects</option>
                {projects.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            {/* Stat cards */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
              <StatCard label="sessions" value={stats.sessions} />
              <StatCard label="files touched" value={stats.files} />
              <StatCard
                label="lines changed"
                value={
                  <span className="font-mono text-base">
                    <span className="text-emerald-400">+{fmtTokens(stats.added)}</span>
                    <span className="text-zinc-700">/</span>
                    <span className="text-red-400">-{fmtTokens(stats.removed)}</span>
                  </span>
                }
              />
              <StatCard label="tokens" value={fmtTokens(stats.tokens)} />
              <StatCard
                label="cost"
                value={`$${stats.cost.toFixed(2)}`}
                accent="text-emerald-400"
              />
            </div>

            {/* Churn chart */}
            <div className="border border-zinc-800 rounded-xl bg-zinc-900/40 px-4 pt-4 pb-3 mb-8">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-zinc-500 uppercase tracking-wider">
                  Code changes {RANGES.find((r) => r.key === range)?.label.toLowerCase()}
                </p>
                <p className="text-[11px] text-zinc-600">
                  <span className="text-emerald-500">■</span> added{" "}
                  <span className="text-red-500 ml-2">■</span> removed
                </p>
              </div>
              {hasChurn ? (
                <ChurnChart buckets={buckets} />
              ) : (
                <p className="text-zinc-600 text-xs py-10 text-center">
                  No code changes in this range.
                </p>
              )}
            </div>

            {/* Sessions table */}
            {filtered.length === 0 ? (
              <div className="text-center py-14 text-zinc-500">
                <p className="text-sm">
                  {allSessions.length === 0
                    ? "No sessions yet."
                    : "No sessions in this range."}
                </p>
                <p className="text-xs mt-1">
                  {allSessions.length === 0 ? (
                    <>
                      Run <code className="text-zinc-400">histori up</code> and start a Claude
                      Code session.
                    </>
                  ) : (
                    "Try a wider time range or a different project."
                  )}
                </p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-zinc-500 border-b border-zinc-800">
                    <th className="pb-3 font-normal">Date</th>
                    <th className="pb-3 font-normal">Directory</th>
                    <th className="pb-3 font-normal">Changes</th>
                    <th className="pb-3 font-normal">Model</th>
                    <th className="pb-3 font-normal text-right">Tokens</th>
                    <th className="pb-3 font-normal text-right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => (
                    <tr
                      key={s.id}
                      className="border-b border-zinc-800/40 hover:bg-zinc-900/60 transition-colors"
                    >
                      <td className="py-3 pr-6 text-zinc-500 whitespace-nowrap">
                        {fmtDate(s.startedAt)}
                      </td>
                      <td className="py-3 pr-6 max-w-xs">
                        <Link
                          to={`/sessions/${s.id}`}
                          className="text-zinc-200 hover:text-blue-400 transition-colors truncate block"
                        >
                          {shortDir(s.cwd)}
                        </Link>
                        {s.repo && (
                          <span className="text-zinc-600 text-xs">
                            {s.repo}
                            {s.branch ? `@${s.branch}` : ""}
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-6 whitespace-nowrap">
                        {s.filesChanged > 0 ? (
                          <span className="text-xs">
                            <span className="text-zinc-400">
                              {s.filesChanged} file{s.filesChanged === 1 ? "" : "s"}
                            </span>{" "}
                            <span className="font-mono">
                              <span className="text-emerald-500">+{s.linesAdded}</span>
                              <span className="text-zinc-700">/</span>
                              <span className="text-red-500">-{s.linesRemoved}</span>
                            </span>
                          </span>
                        ) : (
                          <span className="text-zinc-700 text-xs">—</span>
                        )}
                      </td>
                      <td className="py-3 pr-6 text-zinc-600 text-xs whitespace-nowrap">
                        {shortModel(s.model)}
                      </td>
                      <td className="py-3 pr-6 text-right text-zinc-400">
                        {fmtTokens(s.inputTokens + s.outputTokens)}
                      </td>
                      <td className="py-3 text-right">
                        <span
                          className={
                            s.costUsd > 1
                              ? "text-amber-400"
                              : s.costUsd > 0
                                ? "text-emerald-400"
                                : "text-zinc-600"
                          }
                        >
                          ${s.costUsd.toFixed(4)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </main>
    </div>
  );
}
