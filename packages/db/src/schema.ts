import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
} from "drizzle-orm/sqlite-core";

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
    cwd: text("cwd").notNull(),
    repo: text("repo"),
    branch: text("branch"),
    model: text("model"),
    inputTokens: integer("input_tokens").default(0).notNull(),
    outputTokens: integer("output_tokens").default(0).notNull(),
    costUsd: real("cost_usd").default(0).notNull(),
    bookmarked: integer("bookmarked", { mode: "boolean" })
      .default(false)
      .notNull(),
    bookmarkLabel: text("bookmark_label"),
  },
  (t) => ({
    startedAtIdx: index("sessions_started_at_idx").on(t.startedAt),
    repoIdx: index("sessions_repo_idx").on(t.repo),
  }),
);

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    ts: integer("ts", { mode: "timestamp_ms" }).notNull(),
    payload: text("payload", { mode: "json" }).notNull(),
  },
  (t) => ({
    sessionIdx: index("events_session_idx").on(t.sessionId),
    tsIdx: index("events_ts_idx").on(t.ts),
  }),
);

export const fileTouches = sqliteTable(
  "file_touches",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    linesAdded: integer("lines_added").default(0).notNull(),
    linesRemoved: integer("lines_removed").default(0).notNull(),
    tool: text("tool").notNull(),
    ts: integer("ts", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => ({
    sessionIdx: index("file_touches_session_idx").on(t.sessionId),
    pathIdx: index("file_touches_path_idx").on(t.path),
  }),
);

export const rules = sqliteTable("rules", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  path: text("path").notNull(),
  content: text("content").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
});
