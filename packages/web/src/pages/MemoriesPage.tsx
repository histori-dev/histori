import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { api, type Memory } from "../api";
import { Label, TopBar } from "../components/Chrome";

type Kind = "all" | "lesson" | "session";

const KINDS: { key: Kind; label: string }[] = [
  { key: "all", label: "All" },
  { key: "lesson", label: "Lessons" },
  { key: "session", label: "Sessions" },
];

function fmtDate(n: number) {
  return new Date(n).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function kindTone(kind: Memory["kind"]) {
  return kind === "lesson" ? "text-warm" : "text-accent";
}

function kindLabel(kind: Memory["kind"]) {
  return kind === "lesson" ? "saved lesson" : "session memory";
}

export default function MemoriesPage() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [project, setProject] = useState<string>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
    if (selected === id) setSelected(null);
  }

  const projects = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of memories) {
      if (!m.project) continue;
      counts.set(m.project, (counts.get(m.project) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [memories]);

  const filtered = useMemo(
    () =>
      memories.filter((m) => {
        if (kind !== "all" && m.kind !== kind) return false;
        if (project !== "all" && m.project !== project) return false;
        return true;
      }),
    [memories, kind, project],
  );

  const current = filtered.find((m) => m.id === selected) ?? filtered[0] ?? null;

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar
        active="memories"
        right={
          <span>
            {memories.length} memor{memories.length === 1 ? "y" : "ies"}
          </span>
        }
      />

      <div className="flex flex-1 min-h-0">
        {/* Sidebar — search + filters */}
        <aside className="w-60 shrink-0 border-r border-line px-3 py-4 space-y-6 hidden md:block">
          <input
            type="search"
            value={query}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search memories…"
            className="w-full bg-inset border border-line rounded-md px-2.5 py-1.5 text-xs text-ink placeholder-faint outline-none focus:border-line-strong focus:ring-2 focus:ring-sage-tint transition-colors"
          />

          <section>
            <Label className="px-1 mb-2">Kind</Label>
            <div className="flex flex-wrap gap-1">
              {KINDS.map((k) => (
                <button
                  key={k.key}
                  onClick={() => setKind(k.key)}
                  className={`px-2.5 py-1 text-[11px] rounded-md border transition-colors ${
                    kind === k.key
                      ? "bg-inset border-line shadow-sm text-ink font-medium"
                      : "border-transparent text-muted hover:text-ink"
                  }`}
                >
                  {k.label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between px-1 mb-2">
              <Label>Projects</Label>
              <span className="text-[10px] text-faint tabular-nums">{projects.length}</span>
            </div>
            <div className="space-y-1">
              <button
                onClick={() => setProject("all")}
                className={`w-full text-left px-2.5 py-2 rounded-md border transition-colors ${
                  project === "all"
                    ? "bg-inset border-line shadow-sm"
                    : "border-transparent hover:bg-inset/60"
                }`}
              >
                <span className="text-xs font-medium text-ink">All projects</span>
                <p className="text-[10px] text-faint mt-0.5 tabular-nums">
                  {memories.length} memor{memories.length === 1 ? "y" : "ies"}
                </p>
              </button>
              {projects.map(([p, count]) => (
                <button
                  key={p}
                  onClick={() => setProject(project === p ? "all" : p)}
                  className={`w-full text-left px-2.5 py-2 rounded-md border transition-colors ${
                    project === p
                      ? "bg-inset border-line shadow-sm"
                      : "border-transparent hover:bg-inset/60"
                  }`}
                >
                  <span className="text-xs font-medium text-ink truncate block" title={p}>
                    {p}
                  </span>
                  <p className="text-[10px] text-faint mt-0.5 tabular-nums">
                    {count} memor{count === 1 ? "y" : "ies"}
                  </p>
                </button>
              ))}
            </div>
          </section>
        </aside>

        <main className="flex-1 min-w-0 p-4">
          {loading && <p className="text-muted text-sm">Loading…</p>}
          {error && <p className="text-neg-strong text-sm">{error}</p>}

          {!loading && !error && filtered.length === 0 && (
            <div className="text-center py-16 text-muted">
              <p className="text-sm">
                {query || kind !== "all" || project !== "all" ? "No matches." : "No memories yet."}
              </p>
              {!query && kind === "all" && project === "all" && (
                <p className="text-xs mt-2 text-faint">
                  Memories appear ~15 minutes after a session ends, distilled automatically by the
                  daemon. Served back to Claude via{" "}
                  <code className="text-ink bg-surface px-1 rounded">recall_memories</code>.
                </p>
              )}
            </div>
          )}

          {!loading && !error && filtered.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4 items-start">
              {/* List pane */}
              <div className="space-y-1">
                {filtered.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setSelected(m.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-md border transition-colors ${
                      current?.id === m.id
                        ? "bg-inset border-line shadow-sm"
                        : "border-transparent hover:bg-inset/60"
                    }`}
                  >
                    <span className="text-xs font-medium text-ink block truncate">{m.title}</span>
                    <p className="text-[10px] text-faint mt-0.5">
                      <span className={kindTone(m.kind)}>{kindLabel(m.kind)}</span>
                      {m.project && <span> · {m.project}</span>}
                      <span> · {fmtDate(m.createdAt)}</span>
                    </p>
                  </button>
                ))}
              </div>

              {/* Reading pane */}
              {current && (
                <div className="bg-inset border border-line rounded-lg shadow-sm sticky top-16">
                  <div className="px-4 py-3 border-b border-line flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <Label className={kindTone(current.kind)}>{kindLabel(current.kind)}</Label>
                      <h2 className="text-ink text-sm font-medium mt-1">{current.title}</h2>
                      <p className="text-[10px] text-faint mt-0.5">
                        {current.project && <span>{current.project} · </span>}
                        {fmtDate(current.createdAt)}
                      </p>
                    </div>
                    <button
                      onClick={() => void handleDelete(current.id)}
                      className="text-faint hover:text-neg-strong text-xs transition-colors shrink-0"
                    >
                      delete
                    </button>
                  </div>
                  <pre className="px-4 py-3 text-xs text-muted whitespace-pre-wrap leading-relaxed overflow-auto max-h-[70vh] font-mono">
                    {current.content}
                  </pre>
                  {current.sessionId && (
                    <div className="px-4 py-2.5 border-t border-line bg-surface/40">
                      <Link
                        to={`/sessions/${current.sessionId}`}
                        className="text-accent hover:text-accent-strong text-xs transition-colors"
                      >
                        view source session →
                      </Link>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
