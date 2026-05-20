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
