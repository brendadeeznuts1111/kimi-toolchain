import { copyTree, pathExists, readText, removePath } from "./bun-io.ts";

import { join } from "path";
import { BUN_INSTALL_CLI } from "./bun-install-config.ts";
import { desktopRoot, homeDir } from "./paths.ts";
import { spawnBun } from "./tool-runner.ts";
import { ensureDir, sha256File } from "./utils.ts";

/** Captured at module load so tests can override HOME without breaking host seeding. */
const HOST_HOME_SNAPSHOT = homeDir();

const RUNTIME_PACKAGE_TEMPLATE = join(
  import.meta.dir,
  "..",
  "..",
  "templates",
  "desktop-runtime",
  "package.json"
);

export interface ProvisionDesktopRuntimeDepsResult {
  installed: boolean;
  reason: string;
}

/** Dependency names declared by the desktop-runtime template (SSOT for the health check). */
function runtimeDependencyNames(): string[] {
  try {
    const parsed = JSON.parse(readText(RUNTIME_PACKAGE_TEMPLATE)) as {
      dependencies?: Record<string, string>;
    };
    const names = Object.keys(parsed.dependencies ?? {});
    return names.length > 0 ? names : ["typescript"];
  } catch {
    return ["typescript"];
  }
}

/** Template deps whose package.json is missing (or dangling) under `root/node_modules`. */
function missingRuntimeDeps(root: string): string[] {
  return runtimeDependencyNames().filter(
    (dep) => !pathExists(join(root, "node_modules", dep, "package.json"))
  );
}

/** Ensure ~/.kimi-code has node_modules for runtime imports (typescript, effect, …). */
export async function provisionDesktopRuntimeDeps(
  options: { dryRun?: boolean; force?: boolean } = {}
): Promise<ProvisionDesktopRuntimeDepsResult> {
  const root = desktopRoot();
  const destPackage = join(root, "package.json");
  const templateText = await Bun.file(RUNTIME_PACKAGE_TEMPLATE).text();

  ensureDir(root);

  const destExists = pathExists(destPackage);
  const destHash = destExists ? await sha256File(destPackage) : "";
  const templateHash = await sha256File(RUNTIME_PACKAGE_TEMPLATE);
  const packageChanged = !destExists || destHash !== templateHash;
  const missing = missingRuntimeDeps(root);
  const needsInstall = packageChanged || missing.length > 0;

  if (!needsInstall) {
    return { installed: false, reason: "runtime dependencies already satisfied" };
  }

  if (options.dryRun) {
    return {
      installed: false,
      reason: packageChanged
        ? `would update package.json and run ${BUN_INSTALL_CLI.install}`
        : `would run ${BUN_INSTALL_CLI.install} (missing: ${missing.join(", ")})`,
    };
  }

  if (packageChanged) {
    await Bun.write(destPackage, templateText);
  }

  // The runtime lockfile is disposable and stale whenever an install is needed.
  // Machine policy runs frozenLockfile, which hard-fails on an outdated lockfile.
  for (const lockfile of ["bun.lock", "bun.lockb"]) {
    const lockPath = join(root, lockfile);
    if (pathExists(lockPath)) removePath(lockPath, { force: true });
  }

  if (missing.length > 0 && seedRuntimeNodeModulesFromHost(root)) {
    const stillMissing = missingRuntimeDeps(root);
    if (stillMissing.length === 0) {
      return { installed: true, reason: "seeded node_modules from host runtime" };
    }
  }

  const install = await spawnBun(["install", "--cwd", root]);
  if (install.exitCode !== 0) {
    throw new Error(
      install.stderr.trim() ||
        install.error ||
        `${BUN_INSTALL_CLI.install} failed in ${root} (exit ${install.exitCode})`
    );
  }

  return {
    installed: true,
    reason: packageChanged ? "updated package.json and installed deps" : "installed missing deps",
  };
}

/** Quick health check used by doctor/sync verify. */
export function desktopRuntimeDepsOk(home?: string): boolean {
  const root = desktopRoot(home);
  return missingRuntimeDeps(root).length === 0;
}

function seedRuntimeNodeModulesFromHost(targetRoot: string): boolean {
  const hostModules = join(desktopRoot(HOST_HOME_SNAPSHOT), "node_modules");
  const typescriptPkg = join(hostModules, "typescript", "package.json");
  if (!pathExists(typescriptPkg)) return false;
  const targetModules = join(targetRoot, "node_modules");
  if (pathExists(join(targetModules, "typescript", "package.json"))) return true;
  copyTree(hostModules, targetModules, { recursive: true });
  return pathExists(join(targetModules, "typescript", "package.json"));
}
