import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import chokidar from "chokidar";
import { nanoid } from "nanoid";
import { HISTORI_HOME } from "@histori/shared";
import { sessions, events, fileTouches, type Db } from "@histori/db";

export const GIT_ROOTS_FILE = join(HISTORI_HOME, "git-roots.json");

export function loadRoots(): string[] {
  try {
    return JSON.parse(readFileSync(GIT_ROOTS_FILE, "utf8")) as string[];
  } catch {
    return [];
  }
}

const watchers = new Map<string, ReturnType<typeof chokidar.watch>>();

export function startGitWatcher(db: Db): void {
  reconcile(db);
  // Re-read git-roots.json periodically so `histori watch <dir>` takes
  // effect without restarting the daemon.
  setInterval(() => reconcile(db), 60_000);
}

function reconcile(db: Db): void {
  const roots = new Set(loadRoots());

  for (const [path, watcher] of watchers) {
    if (!roots.has(path)) {
      void watcher.close();
      watchers.delete(path);
      console.log(`[histori] git watcher: stopped ${path}`);
    }
  }

  for (const root of roots) {
    if (!watchers.has(root)) watchRepo(root, db);
  }
}

function watchRepo(repoPath: string, db: Db): void {
  const commitMsgFile = join(repoPath, ".git", "COMMIT_EDITMSG");
  if (!existsSync(commitMsgFile)) {
    // Repo may not have a commit yet — chokidar can watch a missing path,
    // but skip loudly if there's no .git directory at all.
    if (!existsSync(join(repoPath, ".git"))) {
      console.warn(`[histori] skipping (not a git repo): ${repoPath}`);
      return;
    }
  }
  const watcher = chokidar
    .watch(commitMsgFile, { persistent: true, usePolling: false, ignoreInitial: true })
    .on("add", () => void onCommit(repoPath, db))
    .on("change", () => void onCommit(repoPath, db));
  watchers.set(repoPath, watcher);
  console.log(`[histori] git watcher: ${repoPath}`);
}

async function onCommit(repoPath: string, db: Db): Promise<void> {
  try {
    const commit = readCommit(repoPath);
    const now = new Date();
    const sessionId = sessionWindow(repoPath, now);

    await db
      .insert(sessions)
      .values({
        id: sessionId,
        startedAt: now,
        cwd: repoPath,
        repo: commit.repo,
        branch: commit.branch,
        model: null,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      })
      .onConflictDoNothing();

    await db.insert(events).values({
      id: nanoid(),
      sessionId,
      kind: "GitCommit",
      ts: now,
      payload: {
        hash: commit.hash,
        message: commit.message,
        repo: commit.repo,
        branch: commit.branch,
        fileCount: commit.files.length,
      },
    });

    for (const f of commit.files) {
      await db.insert(fileTouches).values({
        id: nanoid(),
        sessionId,
        path: f.path,
        linesAdded: f.added,
        linesRemoved: f.removed,
        tool: "git",
        ts: now,
      });
    }

    const ftsContent = [
      commit.message,
      commit.repo,
      commit.branch,
      ...commit.files.map((f) => f.path),
    ]
      .filter(Boolean)
      .join(" ");

    db.$client
      .prepare("INSERT INTO sessions_fts(session_id, content) VALUES (?, ?)")
      .run(sessionId, ftsContent);

    console.log(
      `[histori] git commit: ${commit.hash.slice(0, 8)} "${commit.message.slice(0, 60)}"`,
    );
  } catch (err) {
    console.error("[histori] git watcher error:", err);
  }
}

function run(cmd: string, cwd: string): string {
  return execSync(cmd, {
    cwd,
    timeout: 5_000,
    stdio: ["pipe", "pipe", "pipe"],
  })
    .toString()
    .trim();
}

function readCommit(repoPath: string) {
  const hash = run("git rev-parse HEAD", repoPath);
  const message = run("git log -1 --format=%s", repoPath);
  const branch = run("git branch --show-current", repoPath);

  let repo: string;
  try {
    repo = basename(run("git remote get-url origin", repoPath), ".git");
  } catch {
    repo = basename(repoPath);
  }

  const files: { path: string; added: number; removed: number }[] = [];
  try {
    const numstat = run("git diff --numstat HEAD~1 HEAD", repoPath);
    for (const line of numstat.split("\n")) {
      if (!line.trim()) continue;
      const parts = line.split("\t");
      const addedStr = parts[0];
      const removedStr = parts[1];
      const filePath = parts.slice(2).join("\t");
      if (filePath && addedStr !== undefined && removedStr !== undefined) {
        files.push({
          path: filePath,
          added: parseInt(addedStr, 10) || 0,
          removed: parseInt(removedStr, 10) || 0,
        });
      }
    }
  } catch {
    // Repo has only one commit — HEAD~1 doesn't exist, no diff available
  }

  return { hash, message, branch, repo, files };
}

function sessionWindow(repoPath: string, now: Date): string {
  const bucket = Math.floor(now.getTime() / (30 * 60 * 1000));
  return `git:${basename(repoPath)}:${bucket}`;
}
