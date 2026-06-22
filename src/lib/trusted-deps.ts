/**
 * trusted-deps.ts — Supply-chain hardening audit for kimi-doctor dimension 11.
 *
 * Checks:
 *   - package.json has explicit trustedDependencies field
 *   - trustedDependencies is an array
 *   - postinstall script exists
 *   - bunfig.toml has ignoreScripts = false
 *   - bun.lock is newer than package.json (lockfile freshness)
 */

import { join } from "path";

export interface TrustedDepsAudit {
  dimension: 11;
  gate: "trusted-dependencies";
  ok: boolean;
  checks: {
    hasTrustedDependenciesField: boolean;
    trustedDependenciesIsArray: boolean;
    rootPostinstallExists: boolean;
    ignoreScriptsEnabled: boolean;
    lockfileFresh: boolean;
  };
  remediation?: string;
}

async function checkLockfileFresh(projectRoot: string): Promise<boolean> {
  try {
    const pkgStat = await Bun.file(join(projectRoot, "package.json")).stat();
    const lockStat = await Bun.file(join(projectRoot, "bun.lock")).stat();
    return lockStat.mtime >= pkgStat.mtime;
  } catch {
    return false;
  }
}

export async function auditTrustedDeps(
  projectRoot: string = process.cwd()
): Promise<TrustedDepsAudit> {
  const pkg = (await Bun.file(join(projectRoot, "package.json")).json()) as {
    trustedDependencies?: unknown;
    scripts?: { postinstall?: string };
  };
  const bunfigText = await Bun.file(join(projectRoot, "bunfig.toml")).text();

  const checks = {
    hasTrustedDependenciesField: "trustedDependencies" in pkg,
    trustedDependenciesIsArray: Array.isArray(pkg.trustedDependencies),
    rootPostinstallExists: typeof pkg.scripts?.postinstall === "string",
    ignoreScriptsEnabled: bunfigText.includes("ignoreScripts = false"),
    lockfileFresh: await checkLockfileFresh(projectRoot),
  };

  const ok = Object.values(checks).every(Boolean);

  return {
    dimension: 11,
    gate: "trusted-dependencies",
    ok,
    checks,
    remediation: !checks.hasTrustedDependenciesField
      ? 'Add "trustedDependencies": [] to package.json'
      : !checks.trustedDependenciesIsArray
        ? "trustedDependencies must be an array"
        : !checks.rootPostinstallExists
          ? "Add a postinstall script to package.json"
          : !checks.ignoreScriptsEnabled
            ? "Set ignoreScripts = false in bunfig.toml [install]"
            : !checks.lockfileFresh
              ? "Run bun install and commit bun.lock"
              : undefined,
  };
}
