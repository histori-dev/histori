import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// The daemon writes whichever port it actually bound to ~/.histori/daemon.port
// (the preferred 7777 can be inside a Windows reserved range).
function daemonTarget(): string {
  const portFile = join(homedir(), ".histori", "daemon.port");
  let port = Number(process.env.HISTORI_PORT ?? 7777);
  if (existsSync(portFile)) {
    const n = Number(readFileSync(portFile, "utf8").trim());
    if (Number.isInteger(n) && n > 0) port = n;
  }
  return `http://localhost:${port}`;
}

const target = daemonTarget();

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/sessions": target,
      "/search": target,
      "/rules": target,
      "/memories": target,
      "/health": target,
    },
  },
});
