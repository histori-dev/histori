import { spawnSync } from "node:child_process";
import { basename } from "node:path";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { HISTORI_HOME } from "@histori/shared";
import { sessions, events, fileTouches, memories, type Db } from "@histori/db";

// The distiller turns raw session logs into knowledge. When a session has
// been idle long enough, it builds a digest (prompts, files, commits) and
// asks Claude — via the user's existing `claude` CLI auth, no API key — to
// extract what was tried, what broke, what was decided. If the CLI is
// unavailable the digest itself is stored, so every session gets exactly
// one memory and there is no retry storm.

const SCAN_INTERVAL_MS = 5 * 60_000;
const IDLE_MS = 15 * 60_000;
const MIN_EVENTS = 5;
const CLAUDE_TIMEOUT_MS = 120_000;

export function startDistiller(db: Db) {
  // First pass shortly after boot (catches sessions that ended while the
  // daemon was down), then on an interval.
  setTimeout(() => void scan(db), 30_000);
  setInterval(() => void scan(db), SCAN_INTERVAL_MS);
}

let scanning = false;

async function scan(db: Db) {
  if (scanning) return;
  scanning = true;
  try {
    type Row = { id: string };
    const candidates = db.$client
      .prepare(
        `SELECT s.id FROM sessions s
         WHERE s.id != 'unknown'
           AND NOT EXISTS (
             SELECT 1 FROM memories m
             WHERE m.session_id = s.id AND m.kind = 'session'
           )
           AND EXISTS (
             SELECT 1 FROM events e
             WHERE e.session_id = s.id AND e.kind = 'UserPromptSubmit'
           )
           AND (SELECT count(*) FROM events e WHERE e.session_id = s.id) >= ?
           AND (SELECT max(e.ts) FROM events e WHERE e.session_id = s.id) < ?
         ORDER BY s.started_at DESC
         LIMIT 3`,
      )
      .all(MIN_EVENTS, Date.now() - IDLE_MS) as Row[];

    for (const { id } of candidates) {
      try {
        await distill(db, id);
      } catch (err) {
        console.error(`[histori] distill failed for ${id}:`, err);
      }
    }
  } finally {
    scanning = false;
  }
}

async function distill(db: Db, sessionId: string) {
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  if (!session) return;

  const [sessionEvents, touches] = await Promise.all([
    db.select().from(events).where(eq(events.sessionId, sessionId)).orderBy(events.ts),
    db.select().from(fileTouches).where(eq(fileTouches.sessionId, sessionId)),
  ]);

  const digest = buildDigest(session, sessionEvents, touches);
  const project = session.repo ?? (session.cwd ? basename(session.cwd) : null);

  const llm = distillWithClaude(digest);
  const title = llm?.title ?? firstPromptTitle(sessionEvents) ?? `Session in ${project ?? "unknown"}`;
  const content = llm ? formatMemory(llm) : digest;

  const id = nanoid();
  await db.insert(memories).values({
    id,
    sessionId,
    kind: "session",
    title,
    content,
    project,
    createdAt: new Date(),
  });
  db.$client
    .prepare("INSERT INTO memories_fts(memory_id, content) VALUES (?, ?)")
    .run(id, `${title}\n${content}`);

  console.log(
    `[histori] distilled ${sessionId} → "${title}"${llm ? "" : " (heuristic — claude CLI unavailable)"}`,
  );
}

type Distilled = {
  title: string;
  summary: string;
  lessons: string[];
  decisions: string[];
};

function distillWithClaude(digest: string): Distilled | null {
  const prompt =
    "You are distilling an AI coding session log into a long-term memory for future sessions. " +
    "Respond with ONLY a JSON object, no markdown fences, with this shape: " +
    '{"title": "short specific title (max 80 chars)", ' +
    '"summary": "2-3 sentences: what was worked on and the outcome", ' +
    '"lessons": ["up to 3: what broke and how it was fixed, gotchas, things to avoid"], ' +
    '"decisions": ["up to 3: technical decisions made and why"]}. ' +
    "Omit empty strings from arrays. Be concrete: name files, errors, and versions.";

  try {
    // Instruction goes through stdin too — passing it as an argv string
    // gets mangled by cmd.exe quoting on Windows (shell: true). cwd is
    // ~/.histori so claude doesn't load any project context.
    const result = spawnSync("claude", ["-p", "--model", "haiku"], {
      input: `${prompt}\n\n--- SESSION LOG ---\n${digest}`,
      cwd: HISTORI_HOME,
      encoding: "utf8",
      timeout: CLAUDE_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
      shell: process.platform === "win32",
      windowsHide: true,
    });
    if (result.status !== 0 || !result.stdout) return null;

    // Tolerate stray text around the JSON object
    const start = result.stdout.indexOf("{");
    const end = result.stdout.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    const parsed = JSON.parse(result.stdout.slice(start, end + 1));

    if (typeof parsed.title !== "string" || typeof parsed.summary !== "string") return null;
    return {
      title: parsed.title.slice(0, 120),
      summary: parsed.summary,
      lessons: Array.isArray(parsed.lessons) ? parsed.lessons.filter(Boolean) : [],
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions.filter(Boolean) : [],
    };
  } catch {
    return null;
  }
}

function formatMemory(d: Distilled): string {
  const parts = [d.summary];
  if (d.lessons.length) {
    parts.push("", "Lessons:", ...d.lessons.map((l) => `- ${l}`));
  }
  if (d.decisions.length) {
    parts.push("", "Decisions:", ...d.decisions.map((l) => `- ${l}`));
  }
  return parts.join("\n");
}

function buildDigest(session: any, sessionEvents: any[], touches: any[]): string {
  const lines: string[] = [
    `Session in ${session.cwd}${session.repo ? ` (${session.repo}@${session.branch ?? "?"})` : ""}`,
    `Started ${session.startedAt.toISOString()}, ${sessionEvents.length} events.`,
    "",
  ];

  const prompts = sessionEvents
    .filter((e) => e.kind === "UserPromptSubmit")
    .map((e) => String((e.payload as any)?.prompt ?? "").trim())
    .filter(Boolean);
  if (prompts.length) {
    lines.push(`User prompts (${prompts.length}):`);
    for (const p of prompts.slice(0, 20)) lines.push(`- ${p.slice(0, 400)}`);
    lines.push("");
  }

  if (touches.length) {
    // Collapse repeat touches of the same file
    const byPath = new Map<string, { added: number; removed: number }>();
    for (const t of touches) {
      const cur = byPath.get(t.path) ?? { added: 0, removed: 0 };
      cur.added += t.linesAdded;
      cur.removed += t.linesRemoved;
      byPath.set(t.path, cur);
    }
    lines.push(`Files changed (${byPath.size}):`);
    for (const [path, { added, removed }] of [...byPath].slice(0, 30)) {
      lines.push(`- ${path} +${added}/-${removed}`);
    }
    lines.push("");
  }

  const commits = sessionEvents
    .filter((e) => e.kind === "GitCommit")
    .map((e) => String((e.payload as any)?.message ?? "").trim())
    .filter(Boolean);
  if (commits.length) {
    lines.push(`Commits (${commits.length}):`);
    for (const c of commits.slice(0, 10)) lines.push(`- ${c.slice(0, 200)}`);
    lines.push("");
  }

  const toolCounts = new Map<string, number>();
  for (const e of sessionEvents) {
    if (e.kind !== "PostToolUse") continue;
    const tool = String((e.payload as any)?.tool_name ?? "");
    if (tool) toolCounts.set(tool, (toolCounts.get(tool) ?? 0) + 1);
  }
  if (toolCounts.size) {
    lines.push(
      "Tools used: " +
        [...toolCounts].map(([tool, n]) => `${tool}×${n}`).join(", "),
    );
  }

  return lines.join("\n").slice(0, 24_000);
}

function firstPromptTitle(sessionEvents: any[]): string | null {
  const first = sessionEvents.find((e) => e.kind === "UserPromptSubmit");
  const prompt = String((first?.payload as any)?.prompt ?? "").trim();
  return prompt ? prompt.slice(0, 80) : null;
}
