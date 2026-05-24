import { mkdirSync, openSync, closeSync, statSync, createReadStream } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { nanoid } from "nanoid";
import { HISTORI_HOME } from "@histori/shared";
import { sessions, events, type Db } from "@histori/db";
import chokidar from "chokidar";

const FILE = join(HISTORI_HOME, "events.ndjson");
let lastSize = 0;

export function startWatcher(db: Db) {
  mkdirSync(HISTORI_HOME, { recursive: true });
  closeSync(openSync(FILE, "a"));
  lastSize = statSync(FILE).size;

  chokidar
    .watch(FILE, { persistent: true, usePolling: false })
    .on("change", () => void readNew(db));
}

async function readNew(db: Db) {
  const size = statSync(FILE).size;
  if (size <= lastSize) return;

  const stream = createReadStream(FILE, { start: lastSize, end: size });
  lastSize = size;

  const rl = createInterface({ input: stream });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line);
      await ingest(db, ev);
    } catch (err) {
      console.error("[histori] failed to parse event:", err);
    }
  }
}

async function ingest(db: Db, ev: any) {
  const sessionId = ev.payload?.session_id ?? ev.payload?.sessionId ?? "unknown";
  const ts = new Date(ev.ts ?? Date.now());

  // Always upsert a session row so foreign-key constraints hold even when
  // events arrive before SessionStart (or SessionStart is missing entirely).
  await db
    .insert(sessions)
    .values({
      id: sessionId,
      startedAt: ts,
      cwd: ev.cwd ?? "",
      repo: null,
      branch: null,
      model: ev.payload?.model ?? null,
    })
    .onConflictDoNothing();

  await db.insert(events).values({
    id: nanoid(),
    sessionId,
    kind: ev.kind ?? "Unknown",
    ts,
    payload: ev.payload ?? {},
  });
}
