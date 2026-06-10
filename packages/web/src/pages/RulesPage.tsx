import { useEffect, useMemo, useState } from "react";
import { api, type Rule } from "../api";
import { Label, TopBar } from "../components/Chrome";

function fmtDate(n: number) {
  return new Date(n).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function RulesPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .rules()
      .then(setRules)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  async function handleDelete(id: string) {
    await api.deleteRule(id);
    setRules((prev) => prev.filter((r) => r.id !== id));
    if (selected === id) setSelected(null);
  }

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rules;
    return rules.filter(
      (r) => r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q),
    );
  }, [rules, filter]);

  const current = filtered.find((r) => r.id === selected) ?? filtered[0] ?? null;

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar
        active="rules"
        right={
          <span>
            {rules.length} rule{rules.length === 1 ? "" : "s"} ·{" "}
            <code className="text-muted">histori rules sync</code>
          </span>
        }
      />

      <main className="flex-1 min-w-0 p-4">
        {loading && <p className="text-muted text-sm">Loading…</p>}
        {error && <p className="text-neg-strong text-sm">{error}</p>}

        {!loading && !error && rules.length === 0 && (
          <div className="text-center py-16 text-muted">
            <p className="text-sm">No rules yet.</p>
            <p className="text-xs mt-2 text-faint">
              Start a Claude Code session in a project with a{" "}
              <code className="text-ink bg-surface px-1 rounded">CLAUDE.md</code> — histori imports
              it automatically.
            </p>
            <p className="text-xs mt-1 text-faint">
              Or run <code className="text-ink bg-surface px-1 rounded">histori rules sync</code>{" "}
              to import manually.
            </p>
          </div>
        )}

        {!loading && !error && rules.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 items-start">
            {/* List pane */}
            <div>
              <input
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter rules…"
                className="w-full bg-inset border border-line rounded-md px-2.5 py-1.5 text-xs text-ink placeholder-faint outline-none focus:border-line-strong focus:ring-2 focus:ring-sage-tint transition-colors mb-2"
              />
              <Label className="px-1 mb-2">
                Rules registry — {filtered.length} of {rules.length}
              </Label>
              <div className="space-y-1">
                {filtered.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setSelected(r.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-md border transition-colors ${
                      current?.id === r.id
                        ? "bg-inset border-line shadow-sm"
                        : "border-transparent hover:bg-inset/60"
                    }`}
                  >
                    <span className="text-xs font-medium text-ink block truncate">{r.name}</span>
                    <p className="text-[10px] text-faint mt-0.5 truncate" title={r.path}>
                      {r.path}
                    </p>
                    <p className="text-[10px] text-faint mt-0.5 tabular-nums">
                      {fmtDate(r.updatedAt)} · {r.content.split("\n").length} lines
                    </p>
                  </button>
                ))}
                {filtered.length === 0 && (
                  <p className="text-faint text-xs px-1 py-4">No rules match the filter.</p>
                )}
              </div>
            </div>

            {/* Reading pane */}
            {current && (
              <div className="bg-inset border border-line rounded-lg shadow-sm sticky top-16">
                <div className="px-4 py-3 border-b border-line flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <Label>CLAUDE.md</Label>
                    <h2 className="text-ink text-sm font-medium mt-1">{current.name}</h2>
                    <p className="text-[10px] text-faint mt-0.5 truncate" title={current.path}>
                      {current.path}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[10px] text-faint tabular-nums">
                      updated {fmtDate(current.updatedAt)}
                    </span>
                    <button
                      onClick={() => void handleDelete(current.id)}
                      className="text-faint hover:text-neg-strong text-xs transition-colors"
                    >
                      delete
                    </button>
                  </div>
                </div>
                <pre className="px-4 py-3 text-xs text-muted whitespace-pre-wrap leading-relaxed overflow-auto max-h-[75vh] font-mono">
                  {current.content}
                </pre>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
