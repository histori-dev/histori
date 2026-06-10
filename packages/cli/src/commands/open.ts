import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { DAEMON_PORT, PORT_FILE } from "@histori/shared";

/** The daemon writes whichever port it actually bound to PORT_FILE. */
function daemonUrl(): string {
  let port = DAEMON_PORT;
  if (existsSync(PORT_FILE)) {
    const n = Number(readFileSync(PORT_FILE, "utf8").trim());
    if (Number.isInteger(n) && n > 0) port = n;
  }
  return `http://localhost:${port}`;
}

export function open() {
  const url = daemonUrl();
  const cmd =
    process.platform === "win32"
      ? "start"
      : process.platform === "darwin"
        ? "open"
        : "xdg-open";
  spawn(cmd, [url], { detached: true, shell: true, stdio: "ignore" }).unref();
  console.log(`opening ${url}`);
}
