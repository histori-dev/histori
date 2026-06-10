import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { api, type Memory } from "../api";

function fmtDate(n: number) {
  return new Date(n).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function MemoriesPage() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  function load(q?: string) {
    api
      .memories(q)
      .then(setMemories)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(() => load(), []);

  function onSearch(q: string) {
    setQuery(q);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => load(q.trim() || undefined), 300);
  }

  async function handleDelete(id: string) {
    await api.deleteMemory(id);
    setMemories((prev) => prev.filter((m) => m.id !== id));
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center gap-4">
        <span className="font-semibold tracking-tight text-zinc-100 shrink-0">histori</span>
        <nav className="flex gap-4 text-sm shrink-0">
          <Link to="/" className="text-zinc-500 hover:text-zinc-300 transition-colors">
            Sessions
          </Link>
          <span className="text-zinc-300">Memories</span>
          <Link to="/rules" className="text-zinc-500 hover:text-zinc-300 transition-colors">
            Rules
          </Link>
        </nav>
        <input
          type="search"
          value={query}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search memories…"
          className="flex-1 max-w-sm bg-zinc-900 border border-zinc-700 rounded-md px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-500 transition-colors"
        />
      </header>

      <main className="px-6 py-6 max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-zinc-100 font-medium">Knowledge base</h1>
          <p className="text-zinc-500 text-sm mt-1">
            Lessons distilled from your sessions, plus memories your agent saved explicitly.
            Served back to Claude via <code className="text-zinc-400">recall_memories</code>.
          </p>
        </div>

        {loading && <p className="text-zinc-500 text-sm">Loading…</p>}
        {error && <p className="text-red-400 text-sm">{error}</p>}

        {!loading && !error && memories.length === 0 && (
          <div className="text-center py-16 text-zinc-600">
            <p className="text-sm">{query ? "No matches." : "No memories yet."}</p>
            {!query && (
              <p className="text-xs mt-2">
                Memories appear ~15 minutes after a session ends, distilled automatically by the
                daemon.
              </p>
            )}
          </div>
        )}

        <div className="space-y-3">
          {memories.map((m) => (
            <div
              key={m.id}
              className="border border-zinc-800 rounded-lg bg-zinc-900/40 overflow-hidden"
            >
              <div
                className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-zinc-900/60 transition-colors"
                onClick={() => setExpanded(expanded === m.id ? null : m.id)}
              >
                <div className="min-w-0">
                  <span className="text-zinc-200 text-sm font-medium">{m.title}</span>
                  <p className="text-zinc-600 text-xs mt-0.5">
                    <span
                      className={
                        m.kind === "lesson" ? "text-amber-500/80" : "text-blue-500/80"
                      }
                    >
                      {m.kind === "lesson" ? "saved lesson" : "session memory"}
                    </span>
                    {m.project && <span> · {m.project}</span>}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0 ml-4">
                  <span className="text-zinc-600 text-xs">{fmtDate(m.createdAt)}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDelete(m.id);
                    }}
                    className="text-zinc-600 hover:text-red-400 text-xs transition-colors px-1"
                  >
                    delete
                  </button>
                  <span className="text-zinc-600 text-xs">{expanded === m.id ? "▲" : "▼"}</span>
                </div>
              </div>

              {expanded === m.id && (
                <div className="px-4 pb-4 border-t border-zinc-800 pt-3">
                  <pre className="text-xs text-zinc-400 whitespace-pre-wrap leading-relaxed overflow-auto max-h-96">
                    {m.content}
                  </pre>
                  {m.sessionId && (
                    <Link
                      to={`/sessions/${m.sessionId}`}
                      className="text-blue-400 hover:text-blue-300 text-xs mt-3 inline-block transition-colors"
                    >
                      view source session →
                    </Link>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
