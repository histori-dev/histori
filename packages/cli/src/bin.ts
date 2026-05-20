#!/usr/bin/env node
import { cac } from "cac";
import kleur from "kleur";
import { install } from "./commands/install.js";
import { up } from "./commands/up.js";
import { down } from "./commands/down.js";
import { open as openCmd } from "./commands/open.js";

const cli = cac("histori");

cli.command("install", "Register histori hooks in Claude Code's settings.json").action(install);
cli.command("up", "Start the histori daemon in the background").action(up);
cli.command("down", "Stop the histori daemon").action(down);
cli.command("open", "Open the local dashboard in your default browser").action(openCmd);

cli.help();
cli.version("0.0.1");

try {
  cli.parse();
  if (!cli.matchedCommand && process.argv.length <= 2) cli.outputHelp();
} catch (err) {
  console.error(kleur.red(`histori: ${(err as Error).message}`));
  process.exit(1);
}
