import { z } from "zod";
import { nanoid } from "nanoid";
import { desc, eq, like, gte, inArray, sql } from "drizzle-orm";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sessions, events, rules, fileTouches, memories, type Db } from "@histori/db";

export function registerTools(server: McpServer, db: Db) {
  server.tool(
    "recall_memories",
    "Search distilled knowledge from past coding sessions: lessons learned, bugs and their fixes, technical decisions and why they were made. Use this FIRST when starting work — it returns conclusions, not raw logs. For full session detail use recall_sessions.",
    {
      query: z.string().describe("Topic, error message, file, library, or decision to search for"),
      limit: z.number().int().min(1).max(20).default(5).describe("Max memories to return"),
    },
    async ({ query, limit }) => {
      let ids: string[] = [];
      try {
        type FtsRow = { memory_id: string };
        const ftsRows = db.$client
          .prepare(
            `SELECT memory_id FROM memories_fts
             WHERE memories_fts MATCH ?
             ORDER BY rank LIMIT ?`,
          )
          .all(query, limit) as FtsRow[];
        ids = ftsRows.map((r) => r.memory_id);
      } catch {
        // FTS5 syntax error — fall back to LIKE
        const pattern = `%${query.toLowerCase()}%`;
        const rows = await db
          .select({ id: memories.id })
          .from(memories)
          .where(like(sql`lower(${memories.title} || ' ' || ${memories.content})`, pattern))
          .orderBy(desc(memories.createdAt))
          .limit(limit);
        ids = rows.map((r) => r.id);
      }

      if (!ids.length) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No matching memories. Try recall_sessions for raw session search.",
            },
          ],
        };
      }

      const rows = await db.select().from(memories).where(inArray(memories.id, ids));
      const byId = new Map(rows.map((r) => [r.id, r]));
      const ordered = ids.map((id) => byId.get(id)).filter((r) => r != null);

      const text = ordered
        .map((m) =>
          [
            `# ${m.title}`,
            `${m.kind === "lesson" ? "saved lesson" : "session memory"}${m.project ? ` | ${m.project}` : ""} | ${m.createdAt.toISOString().slice(0, 10)}${m.sessionId ? ` | session: ${m.sessionId}` : ""}`,
            m.content,
          ].join("\n"),
        )
        .join("\n\n---\n\n");

      return { content: [{ type: "text" as const, text }] };
    },
  );

  server.tool(
    "save_memory",
    "Save a lesson, gotcha, or decision to the user's permanent knowledge base so future sessions can recall it. Use when you discover something non-obvious worth remembering: a tricky bug's root cause, a project constraint, a decision and its rationale.",
    {
      title: z.string().max(120).describe("Short specific title"),
      content: z.string().describe("The lesson or decision. Be concrete: name files, errors, versions, and the why."),
      project: z
        .string()
        .optional()
        .describe("Project or repo this applies to (omit if general)"),
    },
    async ({ title, content, project }) => {
      const id = nanoid();
      await db.insert(memories).values({
        id,
        sessionId: null,
        kind: "lesson",
        title,
        content,
        project: project ?? null,
        createdAt: new Date(),
      });
      db.$client
        .prepare("INSERT INTO memories_fts(memory_id, content) VALUES (?, ?)")
        .run(id, `${title}\n${content}`);
      return {
        content: [{ type: "text" as const, text: `Memory saved: "${title}" (${id})` }],
      };
    },
  );

  server.tool(
    "recall_sessions",
    "Search your past coding sessions by topic, file path, error message, or keyword. Use this before starting work to find previous solutions to similar problems.",
    {
      query: z.string().describe("Topic, file path, error message, or keyword to search for"),
      limit: z.number().int().min(1).max(20).default(5).describe("Max sessions to return"),
    },
    async ({ query, limit }) => {
      // Use FTS5 for ranked full-text search; fall back to LIKE on error
      let ids: string[] = [];
      try {
        type FtsRow = { session_id: string };
        const ftsRows = db.$client
          .prepare(
            `SELECT session_id
             FROM sessions_fts
             WHERE sessions_fts MATCH ?
             GROUP BY session_id
             ORDER BY min(rank)
             LIMIT ?`,
          )
          .all(query, limit * 3) as FtsRow[];
        ids = ftsRows.map((r) => r.session_id);
      } catch {
        // FTS5 query syntax error — fall back to LIKE
        const pattern = `%${query.toLowerCase()}%`;
        const rows = await db
          .select({ sessionId: events.sessionId })
          .from(events)
          .where(like(sql`lower(cast(${events.payload} as text))`, pattern))
          .groupBy(events.sessionId)
          .limit(limit * 3);
        ids = rows.map((r) => r.sessionId);
      }

      if (!ids.length) {
        return { content: [{ type: "text" as const, text: "No matching sessions found." }] };
      }

      const rows = await db
        .select()
        .from(sessions)
        .where(inArray(sessions.id, ids))
        .orderBy(desc(sessions.startedAt))
        .limit(limit);

      const text = rows
        .map((r) =>
          [
            `id:     ${r.id}`,
            `date:   ${r.startedAt.toISOString()}`,
            `dir:    ${r.cwd}${r.repo ? ` (${r.repo}@${r.branch ?? "?"})` : ""}`,
            `cost:   $${r.costUsd.toFixed(4)} | tokens: ${r.inputTokens + r.outputTokens}`,
          ].join("\n"),
        )
        .join("\n\n");

      return { content: [{ type: "text" as const, text }] };
    },
  );

  server.tool(
    "get_session",
    "Get the full detail of a past session: all events, prompts, and file changes. Call recall_sessions first to get an ID.",
    {
      id: z.string().describe("Session ID from recall_sessions"),
    },
    async ({ id }) => {
      const [session] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, id))
        .limit(1);

      if (!session) return { content: [{ type: "text" as const, text: "Session not found." }] };

      const [sessionEvents, touches] = await Promise.all([
        db
          .select()
          .from(events)
          .where(eq(events.sessionId, id))
          .orderBy(events.ts)
          .limit(100),
        db
          .select()
          .from(fileTouches)
          .where(eq(fileTouches.sessionId, id))
          .orderBy(fileTouches.ts),
      ]);

      const lines = [
        `session: ${session.id}`,
        `started: ${session.startedAt.toISOString()}`,
        `repo:    ${session.repo ?? "?"} | branch: ${session.branch ?? "?"}`,
        `cost:    $${session.costUsd.toFixed(4)} | tokens: ${session.inputTokens + session.outputTokens}`,
        "",
        `files touched (${touches.length}):`,
        ...touches.map((t) => `  ${t.path}  +${t.linesAdded}/-${t.linesRemoved}`),
        "",
        `events (${sessionEvents.length}):`,
        ...sessionEvents.map(
          (e) => `  [${e.kind}] ${JSON.stringify(e.payload).slice(0, 200)}`,
        ),
      ];

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );

  server.tool(
    "cost_summary",
    "Get your AI coding cost and token usage for the last N days.",
    {
      days: z
        .number()
        .int()
        .min(1)
        .max(365)
        .default(30)
        .describe("How many days to look back"),
    },
    async ({ days }) => {
      const since = new Date(Date.now() - days * 86_400_000);
      const rows = await db
        .select()
        .from(sessions)
        .where(gte(sessions.startedAt, since));

      const totalCost = rows.reduce((sum, r) => sum + r.costUsd, 0);
      const totalTokens = rows.reduce(
        (sum, r) => sum + r.inputTokens + r.outputTokens,
        0,
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `Last ${days} days: ${rows.length} sessions | ${totalTokens.toLocaleString()} tokens | $${totalCost.toFixed(4)}`,
          },
        ],
      };
    },
  );

  server.tool(
    "list_rules",
    "List your saved coding rules and CLAUDE.md guidelines.",
    {},
    async () => {
      const rows = await db
        .select()
        .from(rules)
        .orderBy(desc(rules.updatedAt));

      if (!rows.length) {
        return {
          content: [{ type: "text" as const, text: "No rules saved yet." }],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: rows.map((r) => `## ${r.name}\n${r.content}`).join("\n\n---\n\n"),
          },
        ],
      };
    },
  );
}
