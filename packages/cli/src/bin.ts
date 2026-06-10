#!/usr/bin/env node
import { cac } from "cac";
import kleur from "kleur";
import { install } from "./commands/install.js";
import { up } from "./commands/up.js";
import { down } from "./commands/down.js";
import { open as openCmd } from "./commands/open.js";
import { mcp } from "./commands/mcp.js";
import { watch, unwatch } from "./commands/watch.js";
import { rulesList, rulesSync, rulesRm } from "./commands/rules.js";

const cli = cac("histori");

cli.command("install", "Register histori hooks and MCP server in Claude Code's settings.json").action(install);
cli.command("up", "Start the histori daemon in the background").action(up);
cli.command("down", "Stop the histori daemon").action(down);
cli.command("open", "Open the local dashboard in your default browser").action(openCmd);
cli.command("mcp", "Start the histori MCP server (used by Claude Code internally)").action(mcp);
cli
  .command("watch [dir]", "Add a git repo to cross-vendor tracking (Cursor, Codex, Gemini, …)")
  .action(watch);
cli
  .command("unwatch [dir]", "Stop tracking a git repo")
  .action(unwatch);
cli.command("rules", "List your saved CLAUDE.md rules").action(rulesList);
cli
  .command("rules sync [dir]", "Import CLAUDE.md from a directory into the rules registry")
  .action(rulesSync);
cli
  .command("rules rm <id>", "Remove a rule by ID prefix")
  .action(rulesRm);

cli.help();
cli.version("0.0.1");

try {
  cli.parse();
  if (!cli.matchedCommand && process.argv.length <= 2) cli.outputHelp();
} catch (err) {
  console.error(kleur.red(`histori: ${(err as Error).message}`));
  process.exit(1);
}
