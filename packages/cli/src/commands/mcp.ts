export async function mcp() {
  // Static specifier so the bundler includes the MCP server in the published
  // package (as a lazy chunk — it only loads when Claude Code spawns
  // `histori mcp` and talks to it over stdio). In dev, tsx resolves the
  // workspace TS source the same way.
  await import("@histori/mcp");
}
