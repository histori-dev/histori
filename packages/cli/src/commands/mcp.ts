import { createRequire } from "node:module";

const requireFn = createRequire(import.meta.url);

export async function mcp() {
  // Resolve the MCP server entrypoint from the workspace package and run it
  // in-process. Claude Code spawns this command and communicates via stdio.
  const entry = requireFn.resolve("@histori/mcp");
  await import(entry);
}
