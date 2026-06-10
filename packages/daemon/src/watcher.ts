import {
  mkdirSync,
  openSync,
  closeSync,
  statSync,
  createReadStream,
  existsSync,
  readFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { execSync } from "node:child_process";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { HISTORI_HOME } from "@histori/shared";
import { sessions, events, fileTouches, rules, type Db } from "@histori/db";
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

const WRITE_TOOLS = new Set(["Write", "write_file"]);
const EDIT_TOOLS = new Set(["Edit", "str_replace_based_edit_tool", "str_replace_editor"]);
const MULTI_EDIT_TOOLS = new Set(["MultiEdit", "multi_edit"]);

function countLines(s: string): number {
  return s ? s.split("\n").length : 0;
}

function estimateCost(
  model: string | null | undefined,
  inputTokens: number,
  outputTokens: number,
): number {
  const m = (model ?? "").toLowerCase();
  let inputRate: number, outputRate: number;
  if (m.includes("opus")) {
    inputRate = 15;
    outputRate = 75;
  } else if (m.includes("haiku")) {
    inputRate = 0.8;
    outputRate = 4;
  } else {
    inputRate = 3; // sonnet default
    outputRate = 15;
  }
  return (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000;
}

function gitStr(cwd: string, cmd: string): string | null {
  try {
    return execSync(cmd, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || null;
  } catch {
    return null;
  }
}

async function ingest(db: Db, ev: any) {
  const sessionId = ev.payload?.session_id ?? ev.payload?.sessionId ?? "unknown";
  const ts = new Date(ev.ts ?? Date.now());
  const kind: string = ev.kind ?? "Unknown";
  const payload = ev.payload ?? {};

  await db
    .insert(sessions)
    .values({
      id: sessionId,
      startedAt: ts,
      cwd: ev.cwd ?? "",
      repo: null,
      branch: null,
      model: payload.model ?? null,
    })
    .onConflictDoNothing();

  await db.insert(events).values({
    id: nanoid(),
    sessionId,
    kind,
    ts,
    payload,
  });

  const content = extractContent(ev);
  if (content) {
    db.$client
      .prepare("INSERT INTO sessions_fts(session_id, content) VALUES (?, ?)")
      .run(sessionId, content);
  }

  if (kind === "SessionStart" && ev.cwd) {
    const branch = gitStr(ev.cwd, "git rev-parse --abbrev-ref HEAD");
    const originUrl = gitStr(ev.cwd, "git remote get-url origin");
    const repo = originUrl
      ? originUrl.replace(/\.git$/, "").split(/[:/]/).slice(-2).join("/")
      : null;
    if (branch || repo) {
      await db.update(sessions).set({ branch, repo }).where(eq(sessions.id, sessionId));
    }

    const claudeMd = join(ev.cwd, "CLAUDE.md");
    if (existsSync(claudeMd)) {
      await upsertRule(db, claudeMd, basename(ev.cwd));
    }
  }

  if (kind === "Stop") {
    const usage = payload.usage ?? {};
    const inputTokens =
      (usage.input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0);
    const outputTokens = usage.output_tokens ?? 0;

    const [row] = await db
      .select({ model: sessions.model })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);

    const costUsd = estimateCost(row?.model, inputTokens, outputTokens);

    await db
      .update(sessions)
      .set({ inputTokens, outputTokens, costUsd, endedAt: ts })
      .where(eq(sessions.id, sessionId));
  }

  if (kind === "PostToolUse") {
    const toolName: string = payload.tool_name ?? "";
    const input = payload.tool_input ?? {};

    if (WRITE_TOOLS.has(toolName)) {
      const filePath: string = input.file_path ?? input.path ?? "";
      if (filePath) {
        await db.insert(fileTouches).values({
          id: nanoid(),
          sessionId,
          path: filePath,
          linesAdded: countLines(input.content ?? ""),
          linesRemoved: 0,
          tool: toolName,
          ts,
        });
      }
    } else if (EDIT_TOOLS.has(toolName)) {
      const filePath: string = input.path ?? input.file_path ?? "";
      if (filePath) {
        await db.insert(fileTouches).values({
          id: nanoid(),
          sessionId,
          path: filePath,
          linesAdded: countLines(input.new_string ?? input.new_str ?? ""),
          linesRemoved: countLines(input.old_string ?? input.old_str ?? ""),
          tool: toolName,
          ts,
        });
      }
    } else if (MULTI_EDIT_TOOLS.has(toolName)) {
      const filePath: string = input.path ?? "";
      const edits: any[] = Array.isArray(input.edits) ? input.edits : [];
      if (filePath && edits.length) {
        const linesAdded = edits.reduce(
          (s: number, e: any) => s + countLines(e.new_string ?? e.new_str ?? ""),
          0,
        );
        const linesRemoved = edits.reduce(
          (s: number, e: any) => s + countLines(e.old_string ?? e.old_str ?? ""),
          0,
        );
        await db.insert(fileTouches).values({
          id: nanoid(),
          sessionId,
          path: filePath,
          linesAdded,
          linesRemoved,
          tool: toolName,
          ts,
        });
      }
    }
  }
}

async function upsertRule(db: Db, path: string, projectName: string): Promise<void> {
  try {
    const content = readFileSync(path, "utf8");
    const name = `CLAUDE.md — ${projectName}`;
    const [existing] = await db
      .select({ id: rules.id })
      .from(rules)
      .where(eq(rules.path, path))
      .limit(1);
    if (existing) {
      await db.update(rules).set({ content, name }).where(eq(rules.path, path));
    } else {
      await db.insert(rules).values({ id: nanoid(), name, path, content });
    }
  } catch {
    // Ignore read errors — file may have been deleted between check and read
  }
}

function extractContent(ev: any): string | null {
  const payload = ev.payload ?? {};

  switch (ev.kind) {
    case "UserPromptSubmit": {
      const prompt = payload.prompt ?? payload.message ?? "";
      return typeof prompt === "string" && prompt ? prompt : null;
    }
    case "PreToolUse":
    case "PostToolUse": {
      const tool = payload.tool_name ?? "";
      const path =
        payload.tool_input?.file_path ??
        payload.tool_input?.path ??
        payload.tool_input?.command ??
        "";
      const parts = [tool, path].filter(Boolean);
      return parts.length ? parts.join(" ") : null;
    }
    case "SessionStart": {
      const parts = [ev.cwd, payload.repo, payload.branch].filter(Boolean);
      return parts.length ? parts.join(" ") : null;
    }
    default:
      return null;
  }
}
