// One-off test inspection: file touches, repo enrichment, FTS counts.
import Database from "better-sqlite3";
import { homedir } from "node:os";
import { join } from "node:path";

const db = new Database(join(homedir(), ".histori", "db.sqlite"), { readonly: true });

console.log("== file_touches per session ==");
for (const r of db
  .prepare(
    `SELECT session_id, count(*) n, sum(lines_added) la, sum(lines_removed) lr
     FROM file_touches GROUP BY session_id ORDER BY n DESC LIMIT 5`,
  )
  .all())
  console.log(`${r.session_id.slice(0, 14)}…  touches:${r.n}  +${r.la}/-${r.lr}`);

console.log("\n== repo/branch enrichment (latest 6 sessions) ==");
for (const r of db
  .prepare(`SELECT id, repo, branch, model FROM sessions ORDER BY started_at DESC LIMIT 6`)
  .all())
  console.log(`${r.id.slice(0, 14)}…  repo:${r.repo ?? "-"}  branch:${r.branch ?? "-"}  model:${r.model ?? "-"}`);

console.log("\n== FTS row counts ==");
console.log("sessions_fts:", db.prepare("SELECT count(*) c FROM sessions_fts").get().c);
console.log("memories_fts:", db.prepare("SELECT count(*) c FROM memories_fts").get().c);

console.log("\n== rules ==");
for (const r of db.prepare("SELECT id, name, path FROM rules").all())
  console.log(`${r.id.slice(0, 8)}  ${r.name}  ${r.path}`);
