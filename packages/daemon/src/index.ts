import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { DAEMON_PORT, HISTORI_HOME } from "@histori/shared";
import { openDb } from "@histori/db";
import { startWatcher } from "./watcher.js";
import { routes } from "./routes.js";

const db = openDb();
const app = new Hono();
app.use("*", cors());
app.route("/", routes(db));

const port = DAEMON_PORT;
console.log(`[histori] daemon listening on http://localhost:${port}`);
console.log(`[histori] watching ${HISTORI_HOME}/events.ndjson`);

startWatcher(db);
serve({ fetch: app.fetch, port });
