import { cpSync, existsSync } from "node:fs";
import { homedir as osHomedir } from "node:os";
import { join } from "node:path";
import { desktopRoot } from "./paths.ts";
import { ensureDir, sha256File } from "./utils.ts";

/** Captured at module load so tests can override HOME without breaking host seeding. */
const HOST_HOME_SNAPSHOT = process.env.HOME || osHomedir();

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

  const destExists = existsSync(destPackage);
  const destHash = destExists ? await sha256File(destPackage) : "";
  const templateHash = await sha256File(RUNTIME_PACKAGE_TEMPLATE);
  const packageChanged = !destExists || destHash !== templateHash;
  const needsInstall = packageChanged || !existsSync(typescriptModule);

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

  if (!existsSync(typescriptModule) && seedRuntimeNodeModulesFromHost(root)) {
    return { installed: true, reason: "seeded node_modules from host runtime" };
  }

  const proc = Bun.spawn(["bun", "install", "--cwd", root], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await proc.stderr.text();
    throw new Error(stderr.trim() || `bun install failed in ${root} (exit ${exitCode})`);
  }

  return {
    installed: true,
    reason: packageChanged ? "updated package.json and installed deps" : "installed missing deps",
  };
}

/** Quick health check used by doctor/sync verify. */
export function desktopRuntimeDepsOk(home?: string): boolean {
  const root = desktopRoot(home);
  return existsSync(join(root, "node_modules", "typescript", "package.json"));
}

function seedRuntimeNodeModulesFromHost(targetRoot: string): boolean {
  const hostModules = join(desktopRoot(HOST_HOME_SNAPSHOT), "node_modules");
  const typescriptPkg = join(hostModules, "typescript", "package.json");
  if (!existsSync(typescriptPkg)) return false;
  const targetModules = join(targetRoot, "node_modules");
  if (existsSync(join(targetModules, "typescript", "package.json"))) return true;
  cpSync(hostModules, targetModules, { recursive: true });
  return existsSync(join(targetModules, "typescript", "package.json"));
}
