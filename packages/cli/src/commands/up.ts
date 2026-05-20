import { spawn } from "node:child_process";
import { mkdirSync, openSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import kleur from "kleur";

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

  // For v0.1 we resolve the daemon entrypoint relative to this CLI build.
  // Once published, the daemon is bundled and we'll point at the bundled file.
  const here = dirname(new URL(import.meta.url).pathname.replace(/^\//, ""));
  const daemonEntry = join(here, "..", "..", "..", "daemon", "src", "index.ts");

  const out = openSync(LOG_FILE, "a");
  const child = spawn("npx", ["tsx", daemonEntry], {
    detached: true,
    stdio: ["ignore", out, out],
    shell: process.platform === "win32",
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
