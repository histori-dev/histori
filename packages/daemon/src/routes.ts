import { Hono } from "hono";
import { desc, eq, inArray } from "drizzle-orm";
import { looseFtsQuery } from "@histori/shared";
import { sessions, events, fileTouches, rules, memories, type Db } from "@histori/db";

/** MATCH with strict query first; if it errors or misses, retry loose (OR of prefixes). */
function ftsSearch<T>(db: Db, sqlText: string, query: string, ...rest: unknown[]): T[] {
  const stmt = db.$client.prepare(sqlText);
  try {
    const rows = stmt.all(query, ...rest) as T[];
    if (rows.length) return rows;
  } catch {
    // strict query had FTS5 syntax errors — fall through to loose
  }
  const loose = looseFtsQuery(query);
  if (!loose) return [];
  try {
    return stmt.all(loose, ...rest) as T[];
  } catch {
    return [];
  }
}

export function routes(db: Db) {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/sessions", async (c) => {
    const rows = await db
      .select()
      .from(sessions)
      .orderBy(desc(sessions.startedAt))
      .limit(200);
    return c.json(rows);
  });

  app.get("/sessions/:id", async (c) => {
    const id = c.req.param("id");
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, id))
      .limit(1);
    if (!session) return c.json({ error: "not found" }, 404);

    const [sessionEvents, touches] = await Promise.all([
      db.select().from(events).where(eq(events.sessionId, id)).orderBy(events.ts),
      db.select().from(fileTouches).where(eq(fileTouches.sessionId, id)).orderBy(fileTouches.ts),
    ]);

    return c.json({ session, events: sessionEvents, files: touches });
  });

  app.get("/search", async (c) => {
    const q = c.req.query("q")?.trim();
    const limit = Math.min(Number(c.req.query("limit") ?? 20), 100);

    if (!q) return c.json([]);

    const ids = ftsSearch<{ session_id: string }>(
      db,
      `SELECT session_id
       FROM sessions_fts
       WHERE sessions_fts MATCH ?
       GROUP BY session_id
       ORDER BY min(rank)
       LIMIT ?`,
      q,
      limit,
    ).map((r) => r.session_id);
    if (!ids.length) return c.json([]);

    const rows = await db
      .select()
      .from(sessions)
      .where(inArray(sessions.id, ids));

    // Preserve FTS relevance order
    const byId = new Map(rows.map((r) => [r.id, r]));
    return c.json(ids.map((id) => byId.get(id)).filter(Boolean));
  });

  app.get("/memories", async (c) => {
    const q = c.req.query("q")?.trim();
    if (!q) {
      const rows = await db
        .select()
        .from(memories)
        .orderBy(desc(memories.createdAt))
        .limit(200);
      return c.json(rows);
    }
    const ids = ftsSearch<{ memory_id: string }>(
      db,
      `SELECT memory_id FROM memories_fts
       WHERE memories_fts MATCH ?
       ORDER BY rank LIMIT 50`,
      q,
    ).map((r) => r.memory_id);
    if (!ids.length) return c.json([]);

    const rows = await db.select().from(memories).where(inArray(memories.id, ids));
    const byId = new Map(rows.map((r) => [r.id, r]));
    return c.json(ids.map((id) => byId.get(id)).filter(Boolean));
  });

  app.delete("/memories/:id", async (c) => {
    const id = c.req.param("id");
    await db.delete(memories).where(eq(memories.id, id));
    db.$client.prepare("DELETE FROM memories_fts WHERE memory_id = ?").run(id);
    return c.json({ ok: true });
  });

  app.get("/rules", async (c) => {
    const rows = await db.select().from(rules).orderBy(desc(rules.updatedAt));
    return c.json(rows);
  });

  app.delete("/rules/:id", async (c) => {
    const id = c.req.param("id");
    await db.delete(rules).where(eq(rules.id, id));
    return c.json({ ok: true });
  });

  return app;
}
