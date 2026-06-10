import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { api, type SessionDetail } from "../api";

const KIND_COLOR: Record<string, string> = {
  SessionStart: "text-blue-400",
  UserPromptSubmit: "text-violet-400",
  PreToolUse: "text-yellow-400",
  PostToolUse: "text-emerald-400",
  Stop: "text-zinc-500",
  SubagentStop: "text-zinc-500",
  Notification: "text-sky-400",
  PreCompact: "text-orange-400",
};

function fmtDate(s: string) {
  return new Date(s).toLocaleString();
}

function payloadPreview(p: Record<string, unknown>): string {
  const text =
    typeof p["prompt"] === "string"
      ? p["prompt"]
      : typeof p["tool_name"] === "string"
        ? p["tool_name"]
        : JSON.stringify(p);
  return text.length > 140 ? `${text.slice(0, 140)}…` : text;
}

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api
      .session(id)
      .then(setData)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <div className="min-h-screen">
      {/* Nav */}
      <header className="border-b border-zinc-800 px-6 py-4">
        <Link to="/" className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors">
          ← Sessions
        </Link>
      </header>

      <main className="px-6 py-6 max-w-5xl mx-auto">
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

            <div className="grid grid-cols-[1fr_280px] gap-8">
              {/* Events timeline */}
              <section>
                <h2 className="text-xs text-zinc-500 uppercase tracking-wider mb-3">
                  Events ({data.events.length})
                </h2>
                <div className="space-y-0">
                  {data.events.map((e) => (
                    <div
                      key={e.id}
                      className="flex gap-3 py-2 border-b border-zinc-800/40 items-start"
                    >
                      <span
                        className={`text-xs font-mono shrink-0 w-36 pt-0.5 ${KIND_COLOR[e.kind] ?? "text-zinc-500"}`}
                      >
                        {e.kind}
                      </span>
                      <span className="text-zinc-500 text-xs leading-relaxed">
                        {payloadPreview(e.payload)}
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              {/* Files touched */}
              <section>
                <h2 className="text-xs text-zinc-500 uppercase tracking-wider mb-3">
                  Files ({data.files.length})
                </h2>
                {data.files.length === 0 ? (
                  <p className="text-zinc-700 text-xs">No files recorded</p>
                ) : (
                  <div className="space-y-0">
                    {data.files.map((f) => (
                      <div
                        key={f.id}
                        className="flex justify-between items-center py-2 border-b border-zinc-800/40"
                      >
                        <span
                          className="text-zinc-300 text-xs truncate mr-2"
                          title={f.path}
                        >
                          {f.path.split(/[/\\]/).pop()}
                        </span>
                        <span className="text-xs shrink-0 font-mono">
                          <span className="text-emerald-500">+{f.linesAdded}</span>
                          <span className="text-zinc-700 mx-0.5">/</span>
                          <span className="text-red-500">-{f.linesRemoved}</span>
                        </span>
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
