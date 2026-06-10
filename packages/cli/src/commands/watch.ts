import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import kleur from "kleur";

const HISTORI_HOME = join(homedir(), ".histori");
const GIT_ROOTS_FILE = join(HISTORI_HOME, "git-roots.json");

function loadRoots(): string[] {
  try {
    return JSON.parse(readFileSync(GIT_ROOTS_FILE, "utf8")) as string[];
  } catch {
    return [];
  }
}

function saveRoots(roots: string[]): void {
  mkdirSync(HISTORI_HOME, { recursive: true });
  writeFileSync(GIT_ROOTS_FILE, JSON.stringify(roots, null, 2) + "\n");
}

export function watch(dir?: string) {
  // No argument — list watched repos
  if (!dir) {
    const roots = loadRoots();
    if (roots.length === 0) {
      console.log(kleur.gray("No repos being watched."));
      console.log(`Add one: ${kleur.cyan("histori watch <dir>")}`);
    } else {
      console.log(kleur.gray(`Watching ${roots.length} repo(s):`));
      for (const r of roots) console.log(`  ${kleur.cyan(r)}`);
    }
    return;
  }

  const repoPath = resolve(dir);

  if (!existsSync(join(repoPath, ".git"))) {
    console.error(kleur.red(`Not a git repository: ${repoPath}`));
    process.exit(1);
  }

  const roots = loadRoots();
  if (roots.includes(repoPath)) {
    console.log(kleur.yellow(`Already watching: ${repoPath}`));
    return;
  }

  roots.push(repoPath);
  saveRoots(roots);

  console.log(kleur.green("✓") + ` Watching: ${repoPath}`);
  console.log(
    kleur.gray("  Restart daemon to apply: ") +
      kleur.cyan("histori down && histori up"),
  );
}

export function unwatch(dir?: string) {
  if (!dir) {
    console.error(kleur.red("Usage: histori unwatch <dir>"));
    process.exit(1);
  }

  const repoPath = resolve(dir);
  const roots = loadRoots().filter((r) => r !== repoPath);
  saveRoots(roots);

  console.log(kleur.green("✓") + ` Removed: ${repoPath}`);
  console.log(
    kleur.gray("  Restart daemon to apply: ") +
      kleur.cyan("histori down && histori up"),
  );
}
