import { mkdirSync, existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import kleur from "kleur";

const requireFn = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));

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

/** Does this hook entry (matcher group or legacy flat entry) point at our capture script? */
function isHistoriEntry(entry: any): boolean {
  if (typeof entry?.command === "string") return entry.command.includes("capture.cjs");
  if (Array.isArray(entry?.hooks)) {
    return entry.hooks.some(
      (h: any) => typeof h?.command === "string" && h.command.includes("capture.cjs"),
    );
  }
  return false;
}

export function install() {
  const home = homedir();
  const historiHome = join(home, ".histori");
  const hookPath = join(historiHome, "hooks", "capture.cjs");
  const claudeDir = join(home, ".claude");
  const settingsPath = join(claudeDir, "settings.json");

  mkdirSync(dirname(hookPath), { recursive: true });
  mkdirSync(claudeDir, { recursive: true });

  // Drop the capture script into ~/.histori/hooks/capture.cjs.
  // Published: it ships next to this file in dist/. Dev: workspace package.
  const bundledCapture = join(HERE, "capture.cjs");
  const srcCapture = existsSync(bundledCapture)
    ? bundledCapture
    : requireFn.resolve("@histori/hooks/capture.cjs");
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
    const entries: any[] = settings.hooks[kind] ?? [];
    // Self-heal: drop every old histori entry (including malformed flat ones
    // written by earlier versions), then add back exactly one correct group.
    const cleaned = entries.filter((e) => !isHistoriEntry(e));
    cleaned.push({
      hooks: [{ type: "command", command: `node "${hookPath}" ${kind}` }],
    });
    settings.hooks[kind] = cleaned;
  }

  // Clean up the mcpServers key earlier versions wrote here — Claude Code
  // does not read MCP servers from settings.json.
  if (settings.mcpServers?.histori) {
    delete settings.mcpServers.histori;
    if (Object.keys(settings.mcpServers).length === 0) delete settings.mcpServers;
  }

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  console.log(kleur.green("✓") + " histori hooks installed");
  console.log(kleur.gray(`  capture:  ${hookPath}`));
  console.log(kleur.gray(`  settings: ${settingsPath}`));

  // Register the MCP server at user scope via the claude CLI — the canonical
  // way; it writes to ~/.claude.json which is where Claude Code actually
  // reads MCP servers from.
  // Published: register `node <dist/bin.js> mcp` (the server is bundled in).
  // Dev: run the workspace TS source through npx tsx.
  const q = (p: string) => (process.platform === "win32" ? `"${p}"` : p);
  const bundledBin = join(HERE, "bin.js");
  const mcpCommand = existsSync(bundledBin)
    ? ["node", q(bundledBin), "mcp"]
    : ["npx", "tsx", q(requireFn.resolve("@histori/mcp"))];
  const result = spawnSync(
    "claude",
    ["mcp", "add", "--scope", "user", "histori", "--", ...mcpCommand],
    { encoding: "utf8", shell: process.platform === "win32" },
  );
  if (result.status === 0) {
    console.log(kleur.green("✓") + " histori MCP server registered (user scope)");
    console.log(kleur.gray(`  mcp:      ${mcpCommand.join(" ")}`));
  } else {
    const detail = (result.stderr || result.stdout || "").trim();
    if (detail.includes("already exists")) {
      console.log(kleur.green("✓") + " histori MCP server already registered");
    } else {
      console.log(kleur.yellow("!") + " could not register MCP server automatically");
      if (detail) console.log(kleur.gray(`  ${detail.split("\n")[0]}`));
      console.log(
        kleur.gray("  run manually: ") +
          kleur.cyan(`claude mcp add --scope user histori -- ${mcpCommand.join(" ")}`),
      );
    }
  }

  console.log();
  console.log("Next: " + kleur.cyan("histori up") + " to start the daemon");
}
