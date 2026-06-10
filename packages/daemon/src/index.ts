import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PORT_CANDIDATES, PORT_FILE, HISTORI_HOME } from "@histori/shared";
import { openDb } from "@histori/db";
import { startWatcher } from "./watcher.js";
import { startGitWatcher } from "./git-watcher.js";
import { startDistiller } from "./distiller.js";
import { routes } from "./routes.js";

const db = openDb();
const app = new Hono();
// No CORS on purpose: the dashboard is served same-origin by this daemon
// (vite dev proxies /api). A wildcard here would let any website the user
// visits read their entire prompt history off localhost.
// API lives under /api so SPA routes (/sessions, /memories, /rules) can be
// hard-refreshed in the browser without colliding with JSON endpoints.
app.route("/api", routes(db));

// Serve the built web dashboard if it exists.
// Dev: packages/daemon/src → ../../web/dist (workspace build output).
// Published: bundled into <pkg>/dist/daemon.js → ../web (staged by assets.mjs).
const __dirname = dirname(fileURLToPath(import.meta.url));
const webDistCandidates = [join(__dirname, "../../web/dist"), join(__dirname, "../web")];
const webDist =
  webDistCandidates.find((d) => existsSync(join(d, "index.html"))) ?? webDistCandidates[0]!;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

if (existsSync(join(webDist, "index.html"))) {
  app.get("/*", (c) => {
    const pathname = decodeURIComponent(new URL(c.req.url).pathname);
    const filePath = join(webDist, pathname === "/" ? "index.html" : pathname.slice(1));

    if (existsSync(filePath) && !statSync(filePath).isDirectory()) {
      return new Response(readFileSync(filePath), {
        headers: { "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream" },
      });
    }

    // SPA fallback: let React Router handle client-side routes
    return new Response(readFileSync(join(webDist, "index.html")), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  });
} else {
  app.get("/", (c) =>
    c.html(
      `<!doctype html><html><head><title>histori</title>
<style>body{font-family:monospace;background:#09090b;color:#a1a1aa;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.box{max-width:480px;text-align:center}h1{color:#f4f4f5;font-size:1.25rem}code{background:#18181b;padding:2px 6px;border-radius:4px;color:#e4e4e7}</style>
</head><body><div class="box"><h1>histori dashboard not built</h1>
<p>Run <code>pnpm --filter @histori/web build</code> from the repo root,<br>then restart: <code>histori down &amp;&amp; histori up</code>.</p>
<p style="margin-top:1.5rem;font-size:.875rem">API is live — <a href="/api/health" style="color:#60a5fa">/api/health</a> · <a href="/api/sessions" style="color:#60a5fa">/api/sessions</a></p>
</div></body></html>`,
    ),
  );
}

startWatcher(db);
startGitWatcher(db);
startDistiller(db);
console.log(`[histori] watching ${HISTORI_HOME}/events.ndjson`);

// Windows reserves random port blocks (Hyper-V) — walk the candidate list
// until one binds, then record it so `histori open` knows where to look.
function listen(candidates: number[]) {
  const port = candidates[0];
  const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
    writeFileSync(PORT_FILE, String(info.port));
    console.log(`[histori] daemon listening on http://localhost:${info.port}`);
  });
  server.on("error", (err: NodeJS.ErrnoException) => {
    if ((err.code === "EACCES" || err.code === "EADDRINUSE") && candidates.length > 1) {
      console.warn(`[histori] port ${port} unavailable (${err.code}), trying ${candidates[1]}`);
      listen(candidates.slice(1));
    } else {
      console.error(`[histori] could not bind any port (tried ${PORT_CANDIDATES.join(", ")}):`, err);
      process.exit(1);
    }
  });
}

listen(PORT_CANDIDATES);
