#!/usr/bin/env node
/* eslint-disable */
// histori hook — reads Claude Code hook payload from stdin, appends one NDJSON
// line to ~/.histori/events.ndjson, exits as fast as possible. Must complete
// in milliseconds so Claude Code is never blocked.

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const HOME =
  process.env.HISTORI_HOME ?? path.join(os.homedir(), ".histori");
const FILE = path.join(HOME, "events.ndjson");

let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  stdin += chunk;
});
process.stdin.on("end", () => {
  try {
    fs.mkdirSync(HOME, { recursive: true });
    const kind = process.argv[2] ?? "Unknown";
    const line =
      JSON.stringify({
        kind,
        ts: new Date().toISOString(),
        cwd: process.cwd(),
        payload: stdin ? safeJson(stdin) : null,
      }) + "\n";
    fs.appendFileSync(FILE, line);
  } catch {
    // Hook must never throw — Claude Code would surface the error.
  }
  process.exit(0);
});

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return { raw: s };
  }
}
