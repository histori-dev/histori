# histori

> Local-first observability for your AI coding sessions.

Captures every Claude Code session into a local SQLite database. Search your prompts, track your cost, sync your `CLAUDE.md` across machines, see exactly what your agents did to your code.

**Status:** v0.1 in development. Local-first, dev-first. Team features in v0.2.

## What it does

- Hooks into Claude Code via its native `settings.json` hooks — no reverse engineering, no binary wrapping.
- Streams every prompt, tool call, file diff, token count, and cost into a local SQLite database.
- Serves a dashboard on `localhost:7777` for searching your history, reviewing diffs, and tracking cost.
- Everything stays on your machine. Cloud sync is opt-in.

## Install (coming soon)

```bash
npx histori install
histori up
histori open
```

## Roadmap

### v0.1 — Personal companion (in development)
- Claude Code hook capture → local SQLite
- Local dashboard: sessions list, session detail, cost stats
- Search across prompts and file paths
- Bookmark sessions
- `CLAUDE.md` registry across machines

### v0.2 — MCP + cloud sync
- **MCP server** — expose your history to Claude Code itself. *"Have I solved this before?"* becomes a one-call recall. Past sessions and rules surface as live context to future agents.
- Opt-in cloud sync — same SQLite, replicated to your account.
- Team tier — shared rule library, cross-dev cost views, regression-to-session linking.

### v0.3 — Cross-vendor
- Cursor and Copilot adapters via wrapped sessions and editor extensions.

## Stack

- Node + Hono + Drizzle + `better-sqlite3` (daemon)
- Vite + React 19 + React Router v7 + shadcn + Tailwind v4 (local dashboard)
- pnpm + Turborepo (monorepo)
- MIT

## License

MIT © 2026 Oliyad Bekele
