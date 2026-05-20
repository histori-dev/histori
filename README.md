# histori

> Local-first observability for your AI coding sessions.

Captures your Claude Code sessions to a local SQLite database. Search your prompts, track your cost, sync your `CLAUDE.md` across machines, see what your agents actually did.

**Status:** v0.1 in development. Personal tier first. Team features in v0.2.

## What it does (v0.1)

- Hooks into Claude Code via its native `settings.json` hook system — no reverse-engineering, no binary wrapping.
- Streams every prompt, tool call, file diff, and session into a local SQLite database.
- Serves a dashboard on `localhost:7777` for searching your history, reviewing diffs, and tracking cost.
- Everything stays on your machine. Cloud sync is opt-in, planned for v0.2.

## Install (coming soon)

```bash
npx histori install
histori up
histori open
```

## Stack

- Node + Hono + Drizzle + `better-sqlite3` (daemon)
- Vite + React 19 + React Router v7 + shadcn + Tailwind v4 (local dashboard)
- pnpm + Turborepo (monorepo)
- MIT

## License

MIT © 2026 Oliyad Bekele
