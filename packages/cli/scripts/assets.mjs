// Stages the non-code assets the published package needs, after tsup runs:
//   dist/capture.cjs   hook script `histori install` copies to ~/.histori
//   migrations/        drizzle SQL — db code resolves "../migrations" from dist/
//   web/               built dashboard — daemon resolves "../web" from dist/
//   README.md          repo readme, shown on npm
import { copyFileSync, cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = dirname(dirname(fileURLToPath(import.meta.url))); // packages/cli
const root = dirname(dirname(pkg)); // repo root

copyFileSync(join(root, "packages", "hooks", "capture.cjs"), join(pkg, "dist", "capture.cjs"));

rmSync(join(pkg, "migrations"), { recursive: true, force: true });
cpSync(join(root, "packages", "db", "migrations"), join(pkg, "migrations"), { recursive: true });

const webDist = join(root, "packages", "web", "dist");
if (!existsSync(join(webDist, "index.html"))) {
  console.error("[assets] packages/web/dist missing — run the web build first (pnpm build)");
  process.exit(1);
}
rmSync(join(pkg, "web"), { recursive: true, force: true });
cpSync(webDist, join(pkg, "web"), { recursive: true });

copyFileSync(join(root, "README.md"), join(pkg, "README.md"));

console.log("[assets] staged dist/capture.cjs, migrations/, web/, README.md");
