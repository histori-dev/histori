import { spawn } from "node:child_process";

const URL_ = "http://localhost:7777";

export function open() {
  const cmd =
    process.platform === "win32"
      ? "start"
      : process.platform === "darwin"
        ? "open"
        : "xdg-open";
  spawn(cmd, [URL_], { detached: true, shell: true, stdio: "ignore" }).unref();
  console.log(`opening ${URL_}`);
}
