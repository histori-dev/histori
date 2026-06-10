import {
  mkdirSync,
  openSync,
  closeSync,
  statSync,
  createReadStream,
  existsSync,
  readFileSync,
  writeFileSync,
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
// Persisted read offset — events appended while the daemon is down are
// picked up on the next start instead of being skipped forever.
const OFFSET_FILE = join(HISTORI_HOME, "events.offset");
let lastSize = 0;

function loadOffset(size: number): number {
  try {
    const saved = Number(readFileSync(OFFSET_FILE, "utf8").trim());
    // If the file shrank (rotated/cleared), start over from the beginning.
    if (Number.isInteger(saved) && saved >= 0 && saved <= size) return saved;
  } catch {
    // No offset yet — first run after install/upgrade. Start at the current
    // end so we don't replay history that may already be in the database.
  }
  return size;
}

export function startWatcher(db: Db) {
  mkdirSync(HISTORI_HOME, { recursive: true });
  closeSync(openSync(FILE, "a"));
  lastSize = loadOffset(statSync(FILE).size);

  chokidar
    .watch(FILE, { persistent: true, usePolling: false })
    .on("change", () => void readNew(db));

  // Catch up on anything written while the daemon was down
  void readNew(db);
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

  try {
    writeFileSync(OFFSET_FILE, String(size));
  } catch {
    // Non-fatal — worst case we re-read a batch on restart
  }
}

const WRITE_TOOLS = new Set(["Write", "write_file"]);
const EDIT_TOOLS = new Set(["Edit", "str_replace_based_edit_tool", "str_replace_editor"]);
const MULTI_EDIT_TOOLS = new Set(["MultiEdit", "multi_edit"]);

function countLines(s: string): number {
  return s ? s.split("\n").length : 0;
}

function rates(model: string): { input: number; output: number } {
  const m = model.toLowerCase();
  // "fable" is an Opus-family alias — sessions show it interleaved with
  // claude-opus-4-8 message-by-message, so bill it at opus rates.
  if (m.includes("opus") || m.includes("fable")) return { input: 5, output: 25 };
  if (m.includes("haiku")) return { input: 1, output: 5 };
  return { input: 3, output: 15 }; // sonnet default
}

// The Stop hook payload carries no usage data — but it has transcript_path,
// and every assistant message in the transcript has a real usage object.
// Summing the transcript is idempotent: each Stop recomputes full totals.
export function sumTranscriptUsage(transcriptPath: string): {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  model: string | null;
} | null {
  try {
    const lines = readFileSync(transcriptPath, "utf8").split("\n");
    let inputTokens = 0;
    let outputTokens = 0;
    let costUsd = 0;
    // A session can interleave models (aliases, /model switches). Report
    // the one that produced the most output tokens.
    const outputByModel = new Map<string, number>();

    for (const line of lines) {
      if (!line.trim()) continue;
      let entry: any;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const usage = entry?.message?.usage;
      if (entry?.type !== "assistant" || !usage) continue;

      const input = usage.input_tokens ?? 0;
      const cacheRead = usage.cache_read_input_tokens ?? 0;
      const output = usage.output_tokens ?? 0;
      // Cache writes: 1h-TTL costs 2x the input rate, 5m-TTL costs 1.25x.
      // Fall back to treating the lump sum as 5m if no breakdown exists.
      const cw1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
      const cw5m =
        usage.cache_creation?.ephemeral_5m_input_tokens ??
        Math.max(0, (usage.cache_creation_input_tokens ?? 0) - cw1h);

      inputTokens += input + cw1h + cw5m + cacheRead;
      outputTokens += output;

      const entryModel: string = entry.message.model ?? "";
      if (entryModel) {
        outputByModel.set(entryModel, (outputByModel.get(entryModel) ?? 0) + output);
      }
      const r = rates(entryModel);
      costUsd +=
        (input * r.input +
          cw1h * r.input * 2 +
          cw5m * r.input * 1.25 +
          cacheRead * r.input * 0.1 +
          output * r.output) /
        1_000_000;
    }

    let model: string | null = null;
    let best = -1;
    for (const [m, out] of outputByModel) {
      if (out > best) {
        best = out;
        model = m;
      }
    }
    // Make multi-model sessions visible — "claude-opus-4-8 +1" tells the
    // user the picker's alias resolved to more than one backend model.
    if (model && outputByModel.size > 1) {
      model = `${model} +${outputByModel.size - 1}`;
    }

    return { inputTokens, outputTokens, costUsd, model };
  } catch {
    return null;
  }
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
    const transcriptPath: string | undefined = payload.transcript_path;
    const totals =
      transcriptPath && existsSync(transcriptPath)
        ? sumTranscriptUsage(transcriptPath)
        : null;

    if (totals) {
      await db
        .update(sessions)
        .set({
          inputTokens: totals.inputTokens,
          outputTokens: totals.outputTokens,
          costUsd: totals.costUsd,
          model: totals.model ?? undefined,
          endedAt: ts,
        })
        .where(eq(sessions.id, sessionId));
    } else {
      await db.update(sessions).set({ endedAt: ts }).where(eq(sessions.id, sessionId));
    }
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
