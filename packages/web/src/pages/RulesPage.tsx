import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api, type Rule } from "../api";

function fmtDate(n: number) {
  return new Date(n).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function RulesPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

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
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-inset px-6 py-4 flex items-center gap-6">
        <span className="font-semibold tracking-tight text-ink">histori</span>
        <nav className="flex gap-4 text-sm">
          <Link to="/" className="text-muted hover:text-ink transition-colors">
            Sessions
          </Link>
          <Link to="/memories" className="text-muted hover:text-ink transition-colors">
            Memories
          </Link>
          <span className="text-ink font-medium">Rules</span>
        </nav>
      </header>

      <main className="px-6 py-6 max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-ink font-semibold">Rules registry</h1>
            <p className="text-muted text-sm mt-1">
              CLAUDE.md files collected across your projects. Served to Claude via the MCP server
              in every session.
            </p>
          </div>
          <span className="text-xs text-muted bg-surface border border-line rounded-full px-3 py-1">
            histori rules sync
          </span>
        </div>

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

        <div className="space-y-3">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="border border-line rounded-xl bg-inset shadow-sm overflow-hidden"
            >
              <div
                className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-surface/70 transition-colors"
                onClick={() => setExpanded(expanded === rule.id ? null : rule.id)}
              >
                <div className="min-w-0">
                  <span className="text-ink text-sm font-medium">{rule.name}</span>
                  <p className="text-faint text-xs mt-0.5 truncate">{rule.path}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0 ml-4">
                  <span className="text-faint text-xs">{fmtDate(rule.updatedAt)}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDelete(rule.id);
                    }}
                    className="text-faint hover:text-neg-strong text-xs transition-colors px-1"
                  >
                    delete
                  </button>
                  <span className="text-faint text-xs">{expanded === rule.id ? "▲" : "▼"}</span>
                </div>
              </div>

              {expanded === rule.id && (
                <pre className="px-4 pb-4 text-xs text-muted whitespace-pre-wrap leading-relaxed border-t border-line pt-3 overflow-auto max-h-96 bg-surface/40">
                  {rule.content}
                </pre>
              )}
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
