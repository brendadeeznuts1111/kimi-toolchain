import { copyTree, listDir, pathExists, readText, removePath } from "./bun-io.ts";

import { join } from "path";
import { BUN_INSTALL_CLI } from "./bun-install-config.ts";
import { logger } from "./logger.ts";
import { desktopRoot, homeDir } from "./paths.ts";
import { spawnBun, type ToolInvocation } from "./tool-runner.ts";
import { ensureDir, sha256File } from "./utils.ts";

export const TAXONOMY_ID_RUNTIME_DEP_CORRUPT = "runtime_dep_corrupt";

/**
 * Thrown when a desktop runtime dep is still missing its package.json after a
 * links-cache purge + one reinstall retry. Carries a taxonomyId so the failure
 * lands in the failure ledger instead of passing silently.
 */
export class RuntimeDepCorruptError extends Error {
  readonly taxonomyId = TAXONOMY_ID_RUNTIME_DEP_CORRUPT;
  readonly missingDeps: readonly string[];

  constructor(missingDeps: readonly string[], root: string) {
    super(
      `runtime_dep_corrupt: ${missingDeps.join(", ")} still missing package.json under ` +
        `${join(root, "node_modules")} after links-cache purge + reinstall. Manual repair: ` +
        `remove the dep's entry under ~/.bun/install/cache/links and run ${BUN_INSTALL_CLI.install}.`
    );
    this.name = "RuntimeDepCorruptError";
    this.missingDeps = missingDeps;
  }
}

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

  // Post-install verification: bun install can exit 0 while delivering a
  // corrupt package tree (observed: package.json missing in a shared
  // isolated-linker links-cache entry, silently poisoning every consumer).
  // Verify, purge the corrupt links entries, retry once, then fail loudly.
  const unresolved = missingRuntimeDeps(root);
  if (unresolved.length > 0) {
    logger.warn(
      `[desktop-runtime-deps] post-install verify: ${unresolved.join(", ")} missing package.json — purging corrupt links-cache entries and retrying once`
    );
    const purged = purgeCorruptLinksEntries(unresolved);
    for (const dir of purged) logger.warn(`[desktop-runtime-deps] purged ${dir}`);
    for (const dep of unresolved) {
      // Drop the dangling node_modules entry (symlink or dir) so the retry re-links it.
      removePath(join(root, "node_modules", dep), { recursive: true, force: true });
    }
    const retry = await spawnBun(["install", "--cwd", root]);
    if (retry.exitCode !== 0) {
      throw new Error(
        retry.stderr.trim() ||
          retry.error ||
          `${BUN_INSTALL_CLI.install} retry failed in ${root} (exit ${retry.exitCode})`
      );
    }
    const stillUnresolved = missingRuntimeDeps(root);
    if (stillUnresolved.length > 0) {
      throw new RuntimeDepCorruptError(stillUnresolved, root);
    }
    return {
      installed: true,
      reason: `repaired corrupt links-cache entries (${unresolved.join(", ")}) and reinstalled deps`,
    };
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

export interface DesktopEntrypointProbeFailure {
  entrypoint: string;
  error: string;
}

export interface DesktopEntrypointProbeResult {
  ok: boolean;
  failures: DesktopEntrypointProbeFailure[];
}

/**
 * Entrypoints import-probed after sync — the exact modules the MCP handshake
 * loads, so a broken runtime closure fails loudly here instead of as a
 * "Connection closed" at the next client session.
 */
const DESKTOP_ENTRYPOINT_PROBES = ["tools/kimi-doctor.ts"] as const;

/** Minimal spawn contract — injectable so unit tests stay off the subprocess boundary. */
export type EntrypointProbeRunner = (
  args: string[],
  options?: { timeoutMs?: number; maxOutputBytes?: number }
) => Promise<Pick<ToolInvocation, "exitCode" | "stderr">>;

/** Import-probe desktop entrypoints (module load only — isDirectRun guards main). */
export async function probeDesktopRuntimeEntrypoints(
  root: string = desktopRoot(),
  run: EntrypointProbeRunner = spawnBun
): Promise<DesktopEntrypointProbeResult> {
  const failures: DesktopEntrypointProbeFailure[] = [];
  for (const rel of DESKTOP_ENTRYPOINT_PROBES) {
    const entry = join(root, rel);
    const probe = await run(
      [
        "-e",
        `import(${JSON.stringify(entry)}).then(() => process.exit(0)).catch((e) => { process.stderr.write(String(e?.message ?? e) + "\\n"); process.exit(1); });`,
      ],
      { timeoutMs: 30_000, maxOutputBytes: 64 * 1024 }
    );
    if (probe.exitCode !== 0) {
      failures.push({ entrypoint: rel, error: probe.stderr.trim() || `exit ${probe.exitCode}` });
      logger.warn(
        `[desktop-runtime-deps] entrypoint probe failed: ${rel} — ${probe.stderr.trim()}`
      );
    }
  }
  return { ok: failures.length === 0, failures };
}

function seedRuntimeNodeModulesFromHost(targetRoot: string): boolean {
  const hostModules = join(desktopRoot(HOST_HOME_SNAPSHOT), "node_modules");
  const typescriptPkg = join(hostModules, "typescript", "package.json");
  if (!pathExists(typescriptPkg)) return false;
  const targetModules = join(targetRoot, "node_modules");
  if (pathExists(join(targetModules, "typescript", "package.json"))) return true;
  // dereference: copy real file contents, not symlinks. Isolated-linker
  // node_modules point into the machine-wide shared links cache — seeding
  // symlinks lets tests/sandboxes delete THROUGH them and corrupt every
  // project on the machine (observed: ts-morph package.json deleted by a
  // unit test cleaning its fake HOME). Dot-dirs (.bun/.bin) are skipped:
  // they hold linker bookkeeping symlinks that may dangle.
  for (const entry of listDir(hostModules)) {
    if (entry.startsWith(".")) continue;
    copyTree(join(hostModules, entry), join(targetModules, entry), {
      recursive: true,
      dereference: true,
    });
  }
  return pathExists(join(targetModules, "typescript", "package.json"));
}

/** Isolated-linker shared links dir (`<cache>/links`); env override wins, leading `~/` expanded. */
function installLinksDir(): string {
  const override = Bun.env.BUN_INSTALL_CACHE_DIR ?? "";
  const cacheDir =
    override.length > 0
      ? override.startsWith("~/")
        ? join(homeDir(), override.slice(2))
        : override
      : join(homeDir(), ".bun", "install", "cache");
  return join(cacheDir, "links");
}

/**
 * Delete links-cache entries for `deps` whose installed package.json is missing
 * (healthy entries are kept — cache entries are shared across projects).
 * Returns the purged directory paths for logging.
 */
export function purgeCorruptLinksEntries(deps: readonly string[]): string[] {
  const linksDir = installLinksDir();
  if (!pathExists(linksDir)) return [];
  const purged: string[] = [];
  for (const dep of deps) {
    // Scoped deps are stored with "+" in place of "/" (e.g. @ts-morph+common@0.26.1-…).
    const prefix = `${dep.replace("/", "+")}@`;
    for (const entry of listDir(linksDir)) {
      if (!entry.startsWith(prefix)) continue;
      const entryDir = join(linksDir, entry);
      if (pathExists(join(entryDir, "node_modules", dep, "package.json"))) continue;
      removePath(entryDir, { recursive: true, force: true });
      purged.push(entryDir);
    }
  }
  return purged;
}
