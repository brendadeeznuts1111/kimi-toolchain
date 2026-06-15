import { existsSync } from "fs";
import { join } from "path";
import { $ } from "bun";

export async function ensureQualityTooling(
  project: string,
  dryRun: boolean,
  log: (step: string, msg: string) => void
) {
  const pkgPath = join(project, "package.json");
  if (!existsSync(pkgPath)) return;

  const pkg = (await Bun.file(pkgPath).json()) as {
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const scripts = pkg.scripts || {};
  const additions: Record<string, string> = {
    test: "bun run scripts/run-tests.ts",
    "test:fast": "bun run scripts/run-tests.ts --fast",
    "test:coverage": "bun run scripts/run-tests.ts --coverage",
    "test:coverage:ci": "bun run scripts/run-tests.ts --ci --coverage",
    check: "bun run scripts/check.ts",
    "check:fast": "bun run scripts/check.ts --fast --timeout 100",
    "check:dry-run": "bun run scripts/check.ts --dry-run",
    "docs:sync": "bun run scripts/readme-sync.ts --fix",
    typecheck: "tsc --noEmit",
    format: "oxfmt --write .",
    "format:check": "oxfmt --check -c .oxfmtrc.json .",
    "format:check:ci": "oxfmt --check --threads=4 -c .oxfmtrc.json .",
    lint: "oxlint src test scripts && bun run scripts/lint-banned-terms.ts",
    "lint:terms": "bun run scripts/lint-banned-terms.ts",
    fix: "kimi-fix .",
  };
  let scriptsChanged = false;
  for (const [key, value] of Object.entries(additions)) {
    if (!scripts[key]) {
      scripts[key] = value;
      scriptsChanged = true;
    }
  }
  if (scriptsChanged) {
    log("package.json", "adding format/lint/test scripts...");
    if (!dryRun) {
      pkg.scripts = scripts;
      await Bun.write(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    }
  }

  const devDeps = pkg.devDependencies || {};
  const missingDeps: string[] = [];
  if (!devDeps.oxfmt) missingDeps.push("oxfmt");
  if (!devDeps.oxlint) missingDeps.push("oxlint");
  if (!devDeps.typescript) missingDeps.push("typescript");
  if (!devDeps["@types/bun"]) missingDeps.push("@types/bun");
  if (missingDeps.length > 0) {
    log("deps", `installing ${missingDeps.join(", ")}...`);
    if (!dryRun) {
      await $`bun add -d ${missingDeps}`.cwd(project).quiet();
    }
  }
}
