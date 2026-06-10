import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { api, type Session } from "../api";

function fmtDate(s: string) {
  return new Date(s).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtTokens(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function shortDir(cwd: string) {
  return cwd.replace(/\\/g, "/").split("/").slice(-2).join("/");
}

function shortModel(model: string | null) {
  if (!model) return "—";
  return model.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}

export default function SessionsPage() {
  const [allSessions, setAllSessions] = useState<Session[]>([]);
  const [results, setResults] = useState<Session[] | null>(null);
  const [query, setQuery] = useState("");
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

  const sessions = results ?? allSessions;

  const totalCost = allSessions.reduce((s, r) => s + r.costUsd, 0);
  const totalTokens = allSessions.reduce((s, r) => s + r.inputTokens + r.outputTokens, 0);
  const totalAdded = allSessions.reduce((s, r) => s + r.linesAdded, 0);
  const totalRemoved = allSessions.reduce((s, r) => s + r.linesRemoved, 0);

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

        {!loading && !error && (
          <div className="flex gap-5 text-sm text-zinc-500 ml-auto">
            {searching ? (
              <span className="text-zinc-600">Searching…</span>
            ) : (
              <>
                <span>
                  <span className="text-zinc-200">{allSessions.length}</span> sessions
                </span>
                <span className="font-mono">
                  <span className="text-emerald-500">+{fmtTokens(totalAdded)}</span>
                  <span className="text-zinc-700">/</span>
                  <span className="text-red-500">-{fmtTokens(totalRemoved)}</span>
                  <span className="text-zinc-500 font-sans"> lines</span>
                </span>
                <span>
                  <span className="text-zinc-200">{fmtTokens(totalTokens)}</span> tokens
                </span>
                <span className="text-emerald-400 font-medium">${totalCost.toFixed(4)}</span>
              </>
            )}
          </div>
        )}
      </header>

      <main className="px-6 py-6 max-w-5xl mx-auto">
        {loading && <p className="text-zinc-500 text-sm">Loading...</p>}
        {error && <p className="text-red-400 text-sm">{error}</p>}

        {!loading && !error && sessions.length === 0 && (
          <div className="text-center py-20 text-zinc-500">
            <p className="text-sm">No sessions yet.</p>
            <p className="text-xs mt-1">
              Run <code className="text-zinc-400">histori up</code> and start a Claude Code session.
            </p>
          </div>
        )}

        {sessions.length > 0 && (
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
              {sessions.map((s) => (
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
                        <span className="text-zinc-400">{s.filesChanged} file{s.filesChanged === 1 ? "" : "s"}</span>{" "}
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
      </main>
    </div>
  );
}
