import { z } from "zod";

export const HOOK_KINDS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Stop",
  "SubagentStop",
  "Notification",
  "PreCompact",
] as const;

export const HookKind = z.enum(HOOK_KINDS);
export type HookKind = z.infer<typeof HookKind>;

export const HookEvent = z.object({
  kind: HookKind,
  sessionId: z.string(),
  ts: z.string().datetime(),
  cwd: z.string().optional(),
  payload: z.record(z.unknown()),
});
export type HookEvent = z.infer<typeof HookEvent>;

export const HISTORI_HOME =
  process.env.HISTORI_HOME ??
  (process.platform === "win32"
    ? `${process.env.USERPROFILE}\\.histori`
    : `${process.env.HOME}/.histori`);

export const DAEMON_PORT = Number(process.env.HISTORI_PORT ?? 7777);

// Fallbacks for when the preferred port can't be bound (Windows reserves
// random port ranges for Hyper-V — e.g. 7777 often falls in an excluded
// block). The daemon writes whichever port it actually bound to PORT_FILE,
// and `histori open` reads it back.
export const PORT_CANDIDATES = [DAEMON_PORT, 8787, 9696, 17777, 27777];

export const PORT_FILE =
  process.platform === "win32"
    ? `${HISTORI_HOME}\\daemon.port`
    : `${HISTORI_HOME}/daemon.port`;
