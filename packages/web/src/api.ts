export type Session = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  cwd: string;
  repo: string | null;
  branch: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  bookmarked: boolean;
  bookmarkLabel: string | null;
};

export type HookEvent = {
  id: string;
  sessionId: string;
  kind: string;
  ts: string;
  payload: Record<string, unknown>;
};

export type FileTouch = {
  id: string;
  sessionId: string;
  path: string;
  linesAdded: number;
  linesRemoved: number;
  tool: string;
  ts: string;
};

export type SessionDetail = {
  session: Session;
  events: HookEvent[];
  files: FileTouch[];
};

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export type Rule = {
  id: string;
  name: string;
  path: string;
  content: string;
  updatedAt: number;
};

async function del(path: string): Promise<void> {
  const res = await fetch(path, { method: "DELETE" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
}

export const api = {
  sessions: () => get<Session[]>("/sessions"),
  session: (id: string) => get<SessionDetail>(`/sessions/${id}`),
  search: (q: string) => get<Session[]>(`/search?q=${encodeURIComponent(q)}`),
  rules: () => get<Rule[]>("/rules"),
  deleteRule: (id: string) => del(`/rules/${id}`),
};
