<h1 align="center">histori</h1>

<p align="center"><b>Memory for AI coding agents. Local-first.</b></p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#mcp-tools">MCP tools</a> ·
  <a href="#cli">CLI</a> ·
  <a href="#contributing">Contributing</a>
</p>

---

Your AI coding agent forgets everything the moment a session ends. The bug it spent an hour fixing, the library version that broke the build, the architectural decision you talked through — gone.

**histori** gives it a memory. It records every coding session into a local SQLite database, distills what was learned, and serves it back to your agent through [MCP](https://modelcontextprotocol.io). The next time you hit a familiar problem, your agent already knows — *"we solved this three weeks ago, here's what worked."*

Everything stays on your machine. No cloud, no API key, no account.

## Features

- **Flight recorder** — every prompt, tool call, file change, token count, and cost, captured via Claude Code's native hooks. No wrappers, no reverse engineering.
- **Knowledge distillation** — when a session ends, histori summarizes it into a durable memory: what was tried, what broke, what fixed it, what was decided.
- **Agent recall via MCP** — your agent searches its own past with `recall_memories` and `recall_sessions`, and saves lessons explicitly with `save_memory`.
- **Full-text search** — SQLite FTS5 across every session and memory, ranked by relevance.
- **Rules registry** — your `CLAUDE.md` files, auto-collected from every project, queryable from anywhere.
- **Cross-vendor tracking** — a git watcher captures commits from *any* tool — Cursor, Codex, Gemini CLI — so your history isn't locked to one vendor.
- **Local dashboard** — sessions, costs, memories, and rules in a clean web UI.

## Quick start

> Requires Node ≥ 22, pnpm, and [Claude Code](https://claude.com/claude-code). npm package coming soon — for now, run from source:

```bash
git clone https://github.com/oli-yad13/histori.git
cd histori
pnpm install
pnpm --filter @histori/web build

cd packages/cli
pnpm dev install   # registers hooks + MCP server in Claude Code
pnpm dev up        # starts the background daemon
pnpm dev open      # opens the dashboard
```

That's it. Use Claude Code normally — sessions appear in the dashboard as you work, and memories are distilled automatically a few minutes after each session ends.

To track repos you work on with *other* tools (Cursor, Codex, …):

```bash
pnpm dev watch ~/code/my-project
```

## How it works

```
Claude Code ──hooks──▶ events.ndjson ──▶ daemon ──▶ SQLite (+FTS5)
Cursor/Codex/… ──git watcher─────────────▶  │            │
                                             ▼            ▼
                                        distiller     dashboard
                                       (memories)    localhost:8787
                                             │
                              MCP server ◀───┘
                          (Claude recalls its own past)
```

- **Hooks** append one NDJSON line per event and exit in milliseconds — your agent is never blocked.
- **The daemon** tails the file, ingests into SQLite, enriches sessions with git metadata, and serves the dashboard + API on localhost.
- **The distiller** waits for a session to go idle, builds a digest, and runs it through the `claude` CLI (using your existing subscription — no API key) to extract lessons and decisions. If the CLI isn't available, it stores a structured digest instead.
- **The MCP server** exposes your history and knowledge base to the agent itself.

## MCP tools

Registered automatically by `histori install`:

| Tool | What the agent gets |
|---|---|
| `recall_memories` | Distilled lessons and decisions matching a query — conclusions, not logs |
| `recall_sessions` | Past sessions matching a topic, file, or error message |
| `get_session` | Full event timeline + file changes for one session |
| `save_memory` | Persist a lesson or decision to the knowledge base mid-session |
| `cost_summary` | Token usage and spend for the last N days |
| `list_rules` | All collected `CLAUDE.md` rules |

## CLI

| Command | |
|---|---|
| `histori install` | Register hooks + MCP server in Claude Code |
| `histori up` / `down` | Start / stop the background daemon |
| `histori open` | Open the dashboard |
| `histori watch [dir]` | Track a repo's commits from any AI tool |
| `histori unwatch [dir]` | Stop tracking a repo |
| `histori rules` | List collected `CLAUDE.md` rules |
| `histori rules sync [dir]` | Import a `CLAUDE.md` manually |
| `histori rules rm <id>` | Remove a rule |

## Privacy

histori is local-first by design:

- All data lives in `~/.histori/` on your machine — one SQLite file you can inspect, back up, or delete.
- The daemon binds to `127.0.0.1` only.
- Distillation runs through your own `claude` CLI authentication; histori itself makes no network calls.

## Development

pnpm + Turborepo monorepo:

```
packages/
  hooks/    capture script (append-only, exits in ms)
  daemon/   ingest, git watcher, distiller, HTTP API
  db/       Drizzle schema + migrations (better-sqlite3)
  mcp/      MCP server (stdio)
  web/      dashboard (Vite, React 19, Tailwind v4)
  cli/      `histori` command
  shared/   types + constants
```

```bash
pnpm install
pnpm typecheck   # all packages
pnpm build
```

## Contributing

Issues and PRs welcome. Good first contributions: adapters for more AI coding tools, distillation prompt improvements, dashboard polish. Open an issue to discuss anything bigger.

## License

MIT © 2026 Oliyad Bekele
