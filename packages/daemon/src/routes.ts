import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import { sessions, events, fileTouches, type Db } from "@histori/db";

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

    const sessionEvents = await db
      .select()
      .from(events)
      .where(eq(events.sessionId, id))
      .orderBy(events.ts);

    const touches = await db
      .select()
      .from(fileTouches)
      .where(eq(fileTouches.sessionId, id))
      .orderBy(fileTouches.ts);

    return c.json({ session, events: sessionEvents, files: touches });
  });

  return app;
}
