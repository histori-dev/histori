import { spawn } from "node:child_process";
import { mkdirSync, openSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import kleur from "kleur";

const requireFn = createRequire(import.meta.url);

const HISTORI_HOME = join(homedir(), ".histori");
const PID_FILE = join(HISTORI_HOME, "daemon.pid");
const LOG_FILE = join(HISTORI_HOME, "daemon.log");

export function up() {
  mkdirSync(HISTORI_HOME, { recursive: true });

  if (existsSync(PID_FILE)) {
    const pid = Number(readFileSync(PID_FILE, "utf8"));
    if (isAlive(pid)) {
      console.log(kleur.yellow("histori daemon already running") + kleur.gray(` (pid ${pid})`));
      return;
    }
  }

  // Published package: the daemon is bundled next to this file (dist/daemon.js).
  // Dev (running from the repo): fall back to the workspace TS source via tsx.
  const bundledDaemon = join(dirname(fileURLToPath(import.meta.url)), "daemon.js");
  // Spawn node directly (no npx, no shell) — the cmd.exe→npx→node chain on
  // Windows drops the stdio redirect, leaving daemon.log permanently empty.
  const nodeArgs = existsSync(bundledDaemon)
    ? [bundledDaemon]
    : [requireFn.resolve("tsx/cli"), requireFn.resolve("@histori/daemon")];

  const out = openSync(LOG_FILE, "a");
  const child = spawn(process.execPath, nodeArgs, {
    detached: true,
    stdio: ["ignore", out, out],
    windowsHide: true,
  });
  child.unref();

  writeFileSync(PID_FILE, String(child.pid));
  console.log(kleur.green("✓") + ` histori daemon started ${kleur.gray(`(pid ${child.pid})`)}`);
  console.log(kleur.gray(`  log: ${LOG_FILE}`));
  console.log("Next: " + kleur.cyan("histori open") + " to view the dashboard");
}

function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
