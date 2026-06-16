import { existsSync } from "fs";
import { join } from "path";
import { $ } from "bun";
import {
  REQUIRED_PACKAGE_SCRIPT_ENTRIES,
  TOOLCHAIN_PACKAGE_SCRIPT_ENTRIES,
} from "./scaffold-templates.ts";
import type { ScaffoldProfile } from "./scaffold-profiles.ts";

export interface PackageJsonScaffold {
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * Inject missing required scripts into package.json.
 * Pure filesystem read/write — no network, no side-effects outside the file.
 * Fast and safe to call in tests without fake devDependencies.
 */
export async function injectMissingScripts(
  project: string,
  dryRun: boolean,
  log: (step: string, msg: string) => void,
  profile: ScaffoldProfile = "app"
): Promise<void> {
  const pkgPath = join(project, "package.json");
  if (!existsSync(pkgPath)) return;

  const pkg = (await Bun.file(pkgPath).json()) as PackageJsonScaffold;
  const scripts = pkg.scripts || {};
  let scriptsChanged = false;
  const entries = {
    ...REQUIRED_PACKAGE_SCRIPT_ENTRIES,
    ...(profile === "toolchain" ? TOOLCHAIN_PACKAGE_SCRIPT_ENTRIES : {}),
  };
  for (const [key, value] of Object.entries(entries)) {
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
}

/**
 * Install missing devDependencies via `bun add`.
 * Side-effect: spawns a network process. Skip in tests by providing
 * devDependencies in the fixture, use dryRun, or call injectMissingScripts directly.
 */
export async function installMissingDeps(
  project: string,
  dryRun: boolean,
  log: (step: string, msg: string) => void
): Promise<void> {
  const pkgPath = join(project, "package.json");
  if (!existsSync(pkgPath)) return;

  const pkg = (await Bun.file(pkgPath).json()) as PackageJsonScaffold;
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

/**
 * Full quality tooling setup: inject missing scripts + install missing deps.
 * Kept for backward compatibility — new callers should consider calling
 * injectMissingScripts and installMissingDeps separately.
 */
export async function ensureQualityTooling(
  project: string,
  dryRun: boolean,
  log: (step: string, msg: string) => void,
  profile: ScaffoldProfile = "app"
): Promise<void> {
  await injectMissingScripts(project, dryRun, log, profile);
  await installMissingDeps(project, dryRun, log);
}
