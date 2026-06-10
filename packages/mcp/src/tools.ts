import { z } from "zod";
import { desc, eq, like, gte, inArray, sql } from "drizzle-orm";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sessions, events, rules, fileTouches, type Db } from "@histori/db";

export function registerTools(server: McpServer, db: Db) {
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
