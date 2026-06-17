/**
 * Light auto-fixes before R-Score / pre-push — lock mtime, README drift, guardian baseline.
 */

import { join } from "path";
import { pathExists } from "./bun-io.ts";
import { guardianDir } from "./paths.ts";
import { checkDocDrift, patchReadmeScripts } from "./readme-sync.ts";
import { runTool, withBunNoOrphans } from "./tool-runner.ts";
import { sha256File } from "./utils.ts";

export interface GovernancePreflightReport {
  actions: string[];
  changed: boolean;
}

/** True when package.json is newer than bun.lock (R-Score noStaleLockfile uses the same rule). */
export function isLockfileMtimeStale(projectDir: string): boolean {
  const lockPath = join(projectDir, "bun.lock");
  const pkgPath = join(projectDir, "package.json");
  if (!pathExists(lockPath) || !pathExists(pkgPath)) return false;
  return Bun.file(pkgPath).lastModified > Bun.file(lockPath).lastModified;
}

/**
 * Refresh bun.lock when package.json mtime is newer (scripts-only edits, no dep drift).
 * Returns true when a refresh was attempted.
 */
export async function refreshStaleLockfile(projectDir: string): Promise<boolean> {
  const lockPath = join(projectDir, "bun.lock");
  const pkgPath = join(projectDir, "package.json");
  if (!pathExists(lockPath) || !pathExists(pkgPath)) return false;
  if (!isLockfileMtimeStale(projectDir)) return false;

  // Frozen policy: only clear mtime stale when lock still matches package.json (scripts-only edits).
  const proc = Bun.spawn(
    withBunNoOrphans(["bun", "install", "--frozen-lockfile", "--ignore-scripts"]),
    {
      cwd: projectDir,
      stdout: "ignore",
      stderr: "ignore",
    }
  );
  const exitCode = await proc.exited;
  if (exitCode !== 0) return false;

  if (Bun.file(lockPath).lastModified <= Bun.file(pkgPath).lastModified) {
    await Bun.write(lockPath, await Bun.file(lockPath).text());
  }
  return true;
}

/** Guardian baseline missing or lock hash differs from stored baseline. */
export async function lockfileNeedsGuardianBaseline(projectDir: string): Promise<boolean> {
  const lockPath = join(projectDir, "bun.lock");
  const hashFile = join(guardianDir(), "lockfile.hash");
  if (!pathExists(lockPath)) return false;
  if (!pathExists(hashFile)) return true;
  const current = await sha256File(lockPath);
  const stored = (await Bun.file(hashFile).text()).trim();
  return current !== stored;
}

export interface GovernancePreflightOptions {
  /** Run kimi-guardian fix when baseline is missing or hash mismatches (default true). */
  guardian?: boolean;
}

/**
 * Fast pre-score fixes: lock mtime, README script drift, guardian baseline.
 * Safe to call from pre-push hooks and `kimi-governance score --preflight`.
 */
export async function runGovernancePreflight(
  projectDir: string,
  options: GovernancePreflightOptions = {}
): Promise<GovernancePreflightReport> {
  const actions: string[] = [];
  const guardian = options.guardian !== false;

  if (await refreshStaleLockfile(projectDir)) {
    actions.push("lockfile_refreshed");
  }

  const drift = await checkDocDrift(projectDir);
  if (drift && !drift.fresh && drift.missingFromReadme.length > 0) {
    const patched = await patchReadmeScripts(projectDir);
    if (patched > 0) actions.push(`readme_patched:${patched}`);
  }

  if (guardian && (await lockfileNeedsGuardianBaseline(projectDir))) {
    const result = await runTool("kimi-guardian", ["fix"], {
      cwd: projectDir,
      timeoutMs: 30_000,
    });
    if (result.exitCode === 0) actions.push("guardian_baselined");
  }

  return { actions, changed: actions.length > 0 };
}
