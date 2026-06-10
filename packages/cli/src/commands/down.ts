import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import kleur from "kleur";

const PID_FILE = join(homedir(), ".histori", "daemon.pid");
const PORT_FILE = join(homedir(), ".histori", "daemon.port");

export function down() {
  if (!existsSync(PID_FILE)) {
    console.log(kleur.yellow("histori daemon is not running"));
    return;
  }
  const pid = Number(readFileSync(PID_FILE, "utf8"));
  try {
    if (process.platform === "win32") {
      // The saved pid is a wrapper (npx/cmd) — plain process.kill would
      // orphan the actual node daemon. /T kills the whole process tree.
      const r = spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
      });
      if (r.status !== 0) throw new Error("taskkill failed");
    } else {
      process.kill(pid);
    }
    cleanup();
    console.log(kleur.green("✓") + ` histori daemon stopped ${kleur.gray(`(pid ${pid})`)}`);
  } catch {
    cleanup();
    console.log(kleur.yellow("daemon was already dead; cleaned pid file"));
  }
}

function cleanup() {
  try {
    unlinkSync(PID_FILE);
  } catch {}
  try {
    unlinkSync(PORT_FILE);
  } catch {}
}
