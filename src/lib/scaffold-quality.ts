import { existsSync } from "fs";
import { join } from "path";
import { $ } from "bun";
import { REQUIRED_PACKAGE_SCRIPT_ENTRIES } from "./scaffold-templates.ts";

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
  let scriptsChanged = false;
  for (const [key, value] of Object.entries(REQUIRED_PACKAGE_SCRIPT_ENTRIES)) {
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
