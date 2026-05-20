import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import kleur from "kleur";

const PID_FILE = join(homedir(), ".histori", "daemon.pid");

export function down() {
  if (!existsSync(PID_FILE)) {
    console.log(kleur.yellow("histori daemon is not running"));
    return;
  }
  const pid = Number(readFileSync(PID_FILE, "utf8"));
  try {
    process.kill(pid);
    unlinkSync(PID_FILE);
    console.log(kleur.green("✓") + ` histori daemon stopped ${kleur.gray(`(pid ${pid})`)}`);
  } catch {
    unlinkSync(PID_FILE);
    console.log(kleur.yellow("daemon was already dead; cleaned pid file"));
  }
}
