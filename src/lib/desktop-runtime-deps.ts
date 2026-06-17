import { copyTree, pathExists } from "./bun-io.ts";

import { join } from "path";
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

/** Ensure ~/.kimi-code has node_modules for runtime imports (typescript, effect, …). */
export async function provisionDesktopRuntimeDeps(
  options: { dryRun?: boolean; force?: boolean } = {}
): Promise<ProvisionDesktopRuntimeDepsResult> {
  const root = desktopRoot();
  const destPackage = join(root, "package.json");
  const templateText = await Bun.file(RUNTIME_PACKAGE_TEMPLATE).text();
  const typescriptModule = join(root, "node_modules", "typescript", "package.json");

  ensureDir(root);

  const destExists = pathExists(destPackage);
  const destHash = destExists ? await sha256File(destPackage) : "";
  const templateHash = await sha256File(RUNTIME_PACKAGE_TEMPLATE);
  const packageChanged = !destExists || destHash !== templateHash;
  const needsInstall = packageChanged || !pathExists(typescriptModule);

  if (!needsInstall) {
    return { installed: false, reason: "runtime dependencies already satisfied" };
  }

  if (options.dryRun) {
    return {
      installed: false,
      reason: packageChanged
        ? "would update package.json and run bun install"
        : "would run bun install (typescript missing)",
    };
  }

  if (packageChanged) {
    await Bun.write(destPackage, templateText);
  }

  if (!pathExists(typescriptModule) && seedRuntimeNodeModulesFromHost(root)) {
    return { installed: true, reason: "seeded node_modules from host runtime" };
  }

  const install = await spawnBun(["install", "--cwd", root]);
  if (install.exitCode !== 0) {
    throw new Error(
      install.stderr.trim() ||
        install.error ||
        `bun install failed in ${root} (exit ${install.exitCode})`
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
  return pathExists(join(root, "node_modules", "typescript", "package.json"));
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
