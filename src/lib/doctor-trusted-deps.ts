/**
 * doctor-trusted-deps.ts — Health checks for trustedDependencies policy and
 * lockfile integrity. Consumed by kimi-doctor.
 */

import { pathExists } from "./bun-io.ts";
import { readUserBunfigLayers } from "./bunfig-redundancy.ts";
import type { HealthCheck } from "./health-check.ts";
import { readPackageManifest } from "./utils.ts";

function check(
  name: string,
  status: HealthCheck["status"],
  message: string,
  fixable = false,
  autoFix?: string
): HealthCheck {
  return { name, status, message, fixable, autoFix };
}

export interface TrustedDepsAuditOptions {
  projectRoot?: string;
}

export async function auditTrustedDeps(opts: TrustedDepsAuditOptions = {}): Promise<HealthCheck[]> {
  const root = opts.projectRoot ?? ".";
  const checks: HealthCheck[] = [];

  // ─── Load package.json ─────────────────────────────────────────────────────
  const pkgPath = `${root}/package.json`;
  const pkg = await readPackageManifest(root);
  if (!pkg) {
    checks.push(check("trusted-deps:package-json", "error", `Could not read ${pkgPath}`, false));
    return checks;
  }

  const hasTrustedDeps = "trustedDependencies" in pkg;
  const trustedDepsIsArray = Array.isArray(pkg.trustedDependencies);
  const hasPostinstall = typeof pkg.scripts?.postinstall === "string";

  checks.push(
    check(
      "trusted-deps:field-exists",
      hasTrustedDeps ? "ok" : "warn",
      hasTrustedDeps
        ? `trustedDependencies declared (${pkg.trustedDependencies?.length ?? 0} entries)`
        : "trustedDependencies field missing from package.json",
      !hasTrustedDeps,
      hasTrustedDeps ? undefined : 'Add "trustedDependencies": [] to package.json'
    )
  );

  if (hasTrustedDeps && !trustedDepsIsArray) {
    checks.push(
      check(
        "trusted-deps:field-type",
        "error",
        "trustedDependencies must be an array",
        true,
        'Set "trustedDependencies": [] in package.json'
      )
    );
  }

  checks.push(
    check(
      "trusted-deps:postinstall",
      hasPostinstall ? "ok" : "warn",
      hasPostinstall
        ? `postinstall script present: ${pkg.scripts?.postinstall}`
        : "postinstall script missing — manual setup required after global install",
      !hasPostinstall,
      !hasPostinstall
        ? 'Add "postinstall": "bun run src/install-hooks/postinstall.ts" to package.json scripts'
        : undefined
    )
  );

  // ─── Load bunfig.toml ──────────────────────────────────────────────────────
  const bunfigPath = `${root}/bunfig.toml`;
  const bunfigExists = await Bun.file(bunfigPath).exists();
  const bunfigText = bunfigExists ? await Bun.file(bunfigPath).text() : "";
  const layers = await readUserBunfigLayers();
  const machineInstall = layers.effective.install;
  const hasIgnoreScriptsFalse = bunfigText.includes("ignoreScripts = false");
  const hasFrozenLockfile = bunfigText.includes("frozenLockfile = true");
  const projectLinkerIsolated = bunfigText.includes('linker = "isolated"');
  const machineLinkerIsolated = machineInstall?.linker === "isolated";
  const hasIsolatedLinker = projectLinkerIsolated || machineLinkerIsolated;
  const projectHasAge = /minimumReleaseAge\s*=\s*259200/.test(bunfigText);
  const machineHasAge = machineInstall?.minimumReleaseAge === 259200;
  const hasMinimumReleaseAge = projectHasAge || machineHasAge;

  checks.push(
    check(
      "trusted-deps:ignore-scripts",
      hasIgnoreScriptsFalse ? "ok" : "warn",
      hasIgnoreScriptsFalse
        ? "bunfig.toml: ignoreScripts = false (lifecycle scripts require explicit trust)"
        : "bunfig.toml: ignoreScripts policy not found",
      !hasIgnoreScriptsFalse,
      "Add ignoreScripts = false to [install] in bunfig.toml"
    )
  );

  checks.push(
    check(
      "trusted-deps:frozen-lockfile",
      hasFrozenLockfile ? "ok" : "warn",
      hasFrozenLockfile
        ? "bunfig.toml: frozenLockfile = true (installs are reproducible)"
        : "bunfig.toml: frozenLockfile policy not found",
      !hasFrozenLockfile,
      "Add frozenLockfile = true to [install] in bunfig.toml"
    )
  );

  checks.push(
    check(
      "trusted-deps:isolated-linker",
      hasIsolatedLinker ? "ok" : "warn",
      hasIsolatedLinker
        ? projectLinkerIsolated
          ? "bunfig.toml: linker = isolated (peer-dependency isolation)"
          : "linker = isolated inherited from machine bunfig"
        : "bunfig.toml: isolated linker policy not found",
      !hasIsolatedLinker,
      'Inherit linker = "isolated" from ~/.bunfig.toml (do not restate in the project)'
    )
  );

  checks.push(
    check(
      "trusted-deps:minimum-release-age",
      hasMinimumReleaseAge ? "ok" : "warn",
      hasMinimumReleaseAge
        ? projectHasAge
          ? "bunfig.toml: minimumReleaseAge = 259200 (3-day supply-chain quarantine)"
          : "minimumReleaseAge = 259200 inherited from machine bunfig"
        : "bunfig.toml: minimumReleaseAge policy not found or misaligned",
      !hasMinimumReleaseAge,
      "Inherit minimumReleaseAge = 259200 from ~/.bunfig.toml (do not restate in the project)"
    )
  );

  // ─── Lockfile freshness ────────────────────────────────────────────────────
  const pkgStat = pathExists(pkgPath) ? await Bun.file(pkgPath).stat() : null;
  const lockPath = `${root}/bun.lock`;
  const lockStat = pathExists(lockPath) ? await Bun.file(lockPath).stat() : null;

  if (!lockStat) {
    checks.push(
      check(
        "trusted-deps:lockfile-exists",
        "error",
        "bun.lock not found",
        true,
        "Run bun install to generate bun.lock"
      )
    );
  } else if (!pkgStat) {
    checks.push(
      check(
        "trusted-deps:lockfile-fresh",
        "warn",
        "Cannot compare lockfile: package.json stat failed"
      )
    );
  } else {
    const lockFresh = lockStat.mtime >= pkgStat.mtime;
    checks.push(
      check(
        "trusted-deps:lockfile-fresh",
        lockFresh ? "ok" : "warn",
        lockFresh
          ? `bun.lock is up-to-date (mtime ${lockStat.mtime.toISOString()})`
          : `bun.lock is older than package.json — may be stale`,
        !lockFresh,
        "Run bun install and commit the updated bun.lock"
      )
    );
  }

  return checks;
}
