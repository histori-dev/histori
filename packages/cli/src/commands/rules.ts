import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import kleur from "kleur";
import { openDb, rules } from "@histori/db";

export async function rulesList() {
  const db = openDb();
  const rows = await db.select().from(rules).orderBy(rules.updatedAt);

  if (!rows.length) {
    console.log(kleur.gray("No rules saved yet."));
    console.log(
      `Run ${kleur.cyan("histori rules sync")} to import a CLAUDE.md, or start a session — ` +
        `histori auto-imports CLAUDE.md files it finds in your project directories.`,
    );
    return;
  }

  for (const r of rows) {
    console.log();
    console.log(`${kleur.bold(r.name)}  ${kleur.gray(r.id.slice(0, 8))}`);
    console.log(kleur.gray(`  ${r.path}`));
    const preview = r.content.slice(0, 100).replace(/\n/g, " ").trimEnd();
    console.log(kleur.gray(`  ${preview}${r.content.length > 100 ? "…" : ""}`));
  }
  console.log();
}

export async function rulesSync(dir?: string) {
  const target = dir ? resolve(dir) : process.cwd();
  const claudeMdPath = join(target, "CLAUDE.md");

  if (!existsSync(claudeMdPath)) {
    console.error(kleur.red(`No CLAUDE.md found in: ${target}`));
    process.exit(1);
  }

  const db = openDb();
  const content = readFileSync(claudeMdPath, "utf8");
  const name = `CLAUDE.md — ${basename(target)}`;

  const [existing] = await db
    .select({ id: rules.id })
    .from(rules)
    .where(eq(rules.path, claudeMdPath))
    .limit(1);

  if (existing) {
    await db.update(rules).set({ content, name }).where(eq(rules.path, claudeMdPath));
    console.log(kleur.green("✓") + ` Updated: ${name}`);
  } else {
    await db.insert(rules).values({ id: nanoid(), name, path: claudeMdPath, content });
    console.log(kleur.green("✓") + ` Imported: ${name}`);
  }
}

export async function rulesRm(id?: string) {
  if (!id) {
    console.error(kleur.red("Usage: histori rules rm <id-prefix>"));
    process.exit(1);
  }

  const db = openDb();
  const all = await db.select().from(rules);
  const match = all.find((r) => r.id.startsWith(id) || r.id === id);

  if (!match) {
    console.error(kleur.red(`No rule found matching: ${id}`));
    process.exit(1);
  }

  await db.delete(rules).where(eq(rules.id, match.id));
  console.log(kleur.green("✓") + ` Deleted: ${match.name}`);
}
