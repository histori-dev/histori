import { defineConfig } from "tsup";

// Bundles the entire toolchain into this one publishable package:
//   dist/bin.js     — the `histori` CLI (includes the MCP server via a
//                     dynamic-import chunk, started by `histori mcp`)
//   dist/daemon.js  — the daemon, spawned detached by `histori up`
// better-sqlite3 stays external (native module, installed by npm).
export default defineConfig({
  entry: {
    bin: "src/bin.ts",
    daemon: "../daemon/src/index.ts",
  },
  format: "esm",
  platform: "node",
  target: "node22",
  external: ["better-sqlite3"],
  clean: true,
  splitting: true,
  sourcemap: false,
  minify: false,
});
