import { mkdirSync, existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import kleur from "kleur";

const HOOK_KINDS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Stop",
  "SubagentStop",
  "Notification",
  "PreCompact",
] as const;

export function install() {
  const home = homedir();
  const historiHome = join(home, ".histori");
  const hookPath = join(historiHome, "hooks", "capture.cjs");
  const claudeDir = join(home, ".claude");
  const settingsPath = join(claudeDir, "settings.json");

  mkdirSync(dirname(hookPath), { recursive: true });
  mkdirSync(claudeDir, { recursive: true });

  // Drop the capture script into ~/.histori/hooks/capture.cjs
  const here = dirname(fileURLToPath(import.meta.url));
  const srcCapture = join(here, "..", "..", "..", "hooks", "capture.cjs");
  copyFileSync(srcCapture, hookPath);

  // Merge hooks into Claude Code's settings.json
  let settings: any = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    } catch {
      settings = {};
    }
  }
  settings.hooks ??= {};

  for (const kind of HOOK_KINDS) {
    settings.hooks[kind] ??= [];
    const already = (settings.hooks[kind] as any[]).some(
      (h) => typeof h?.command === "string" && h.command.includes("histori"),
    );
    if (!already) {
      settings.hooks[kind].push({
        type: "command",
        command: `node "${hookPath}" ${kind}`,
      });
    }
  }

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");

  console.log(kleur.green("✓") + " histori hooks installed");
  console.log(kleur.gray(`  capture: ${hookPath}`));
  console.log(kleur.gray(`  settings: ${settingsPath}`));
  console.log();
  console.log("Next: " + kleur.cyan("histori up") + " to start the daemon");
}
