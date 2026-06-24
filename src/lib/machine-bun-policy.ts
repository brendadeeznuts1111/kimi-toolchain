/**
 * Machine-layer (~) Bun install policy audit.
 * SSOT: ~/.bunfig.toml — shell only bootstraps PATH/BUN_INSTALL.
 *
 * @see https://bun.com/docs/pm/cli/install#configuring-bun-install-with-bunfig-toml
 */

import { join } from "path";
import { TOML } from "bun";
import { pathExists } from "./bun-io.ts";
import type { BunfigInstallSection } from "./bun-install-config.ts";
import {
  BUN_INSTALL_GLOBAL_STORE_ENV,
  BUN_INSTALL_POLICY_MIN_BUN,
  BUN_RUNTIME_TRANSPILER_CACHE_PATH_ENV,
} from "./bun-install-config.ts";
import { bunSecretsMethods, isBunSecretsAvailable } from "./secrets-storage.ts";

export type MachineBunCheck = { ok: boolean; id: string; detail: string };

export type MachineBunPolicyAudit = {
  ok: boolean;
  applicable: boolean;
  bunfigPath: string | null;
  shellPath: string | null;
  checks: MachineBunCheck[];
};

const DEPRECATED_ENV = [
  "BUN_INSTALL_CACHE_DIR",
  BUN_INSTALL_GLOBAL_STORE_ENV,
  BUN_RUNTIME_TRANSPILER_CACHE_PATH_ENV,
] as const;

const MACHINE_MINIMUM_RELEASE_AGE = 259200;

/** Legacy Windows `.bunx` fast-path env block cap (CreateProcessA); fixed in Bun #32644. */
export const WINDOWS_ENV_BLOCK_LEGACY_LIMIT = 32_767;

/** @see https://github.com/oven-sh/bun/commit/1bd44dbe60ff766faadb41e71a8ca67de4c72a6f */
export const WINDOWS_LARGE_ENV_FIX_MIN_BUN = BUN_INSTALL_POLICY_MIN_BUN;

/** True when `version` meets policy min, including `1.4.0-canary.*` prereleases. */
export function runtimeMeetsBunMin(version: string, min: string): boolean {
  if (Bun.semver.satisfies(version, `>=${min}`)) return true;
  const core = version.split("+")[0] ?? version;
  const release = core.split("-")[0] ?? core;
  return Bun.semver.order(release, min) >= 0;
}

export function estimateEnvBlockChars(env: Record<string, string | undefined>): number {
  let total = 0;
  for (const [key, value] of Object.entries(env)) {
    if (value == null || value === "") continue;
    total += key.length + value.length + 2;
  }
  return total;
}

function resolveHome(
  env: Record<string, string | undefined> = Bun.env as Record<string, string | undefined>
): string | null {
  return env.HOME ?? env.USERPROFILE ?? null;
}

function expandTilde(value: string, home: string): string {
  if (value === "~") return home;
  if (value.startsWith("~/")) return join(home, value.slice(2));
  return value;
}

function cacheDirIsAbsolute(raw: string | null | undefined, expanded: string | null): boolean {
  if (raw == null || expanded == null) return false;
  if (raw === "~" || raw.startsWith("~/")) return false;
  return !expanded.includes("/~/");
}

export async function auditMachineBunPolicy(
  env: Record<string, string | undefined> = Bun.env as Record<string, string | undefined>
): Promise<MachineBunPolicyAudit> {
  const checks: MachineBunCheck[] = [];
  const home = resolveHome(env);
  if (!home) {
    checks.push({ ok: false, id: "home", detail: "HOME unset" });
    return { ok: false, applicable: true, bunfigPath: null, shellPath: null, checks };
  }

  const bunfigPath = join(home, ".bunfig.toml");
  const shellPath = join(home, ".config/shell/path.sh");

  if (!pathExists(bunfigPath)) {
    checks.push({
      ok: true,
      id: "bunfig",
      detail: "n/a — ~/.bunfig.toml absent (CI/ephemeral runner)",
    });
    return { ok: true, applicable: false, bunfigPath: null, shellPath, checks };
  }

  let install: BunfigInstallSection | null = null;
  try {
    const parsed = TOML.parse(await Bun.file(bunfigPath).text()) as {
      install?: BunfigInstallSection;
    };
    install = parsed.install ?? null;
    checks.push({ ok: true, id: "bunfig", detail: "~/.bunfig.toml readable" });
  } catch (error) {
    checks.push({
      ok: false,
      id: "bunfig",
      detail: `parse error: ${error instanceof Error ? error.message : String(error)}`,
    });
    return { ok: false, applicable: true, bunfigPath, shellPath, checks };
  }

  const linker = install?.linker ?? null;
  checks.push({
    ok: linker === "isolated",
    id: "linker",
    detail:
      linker === "isolated"
        ? "linker=isolated"
        : `linker=${linker ?? "unset"} — expected isolated at machine layer`,
  });

  const globalStore = install?.globalStore ?? null;
  checks.push({
    ok: globalStore === true,
    id: "globalStore",
    detail:
      globalStore === true
        ? "globalStore=true"
        : `globalStore=${String(globalStore)} — expected true at machine layer`,
  });

  const rawCache = install?.cache?.dir ?? null;
  const cacheDir = rawCache ? expandTilde(rawCache, home) : null;
  const cacheOk = cacheDirIsAbsolute(rawCache, cacheDir);
  checks.push({
    ok: cacheOk,
    id: "cache.dir",
    detail: cacheOk
      ? `absolute cache: ${cacheDir}`
      : `cache.dir must be absolute (got ${rawCache ?? "unset"})`,
  });

  const frozenLockfile = install?.frozenLockfile ?? null;
  checks.push({
    ok: frozenLockfile === true,
    id: "frozenLockfile",
    detail:
      frozenLockfile === true
        ? "frozenLockfile=true (machine CI-safety preset)"
        : `frozenLockfile=${String(frozenLockfile)} — machine preset is true`,
    // soft: warn in CLI, fail in strict machine-bun only — gate treats as warning
  });

  const minimumReleaseAge = install?.minimumReleaseAge ?? null;
  checks.push({
    ok: minimumReleaseAge === MACHINE_MINIMUM_RELEASE_AGE,
    id: "minimumReleaseAge",
    detail:
      minimumReleaseAge === MACHINE_MINIMUM_RELEASE_AGE
        ? `minimumReleaseAge=${MACHINE_MINIMUM_RELEASE_AGE} (3 days)`
        : `minimumReleaseAge=${minimumReleaseAge ?? "unset"} — expected ${MACHINE_MINIMUM_RELEASE_AGE}`,
  });

  for (const name of DEPRECATED_ENV) {
    const value = env[name];
    checks.push({
      ok: value == null || value === "",
      id: `env:${name}`,
      detail:
        value == null || value === ""
          ? `${name} unset`
          : `${name}=${value} — remove; policy is ~/.bunfig.toml`,
    });
  }

  const shellOk = pathExists(shellPath);
  checks.push({
    ok: shellOk,
    id: "shell.path",
    detail: shellOk ? "~/.config/shell/path.sh present" : "missing ~/.config/shell/path.sh",
  });

  const secretsOk = isBunSecretsAvailable();
  const methods = bunSecretsMethods();
  checks.push({
    ok: secretsOk && methods.get,
    id: "Bun.secrets",
    detail: secretsOk
      ? `Bun.secrets available (get=${methods.get} set=${methods.set} delete=${methods.delete}; local dev only)`
      : "Bun.secrets unavailable — experimental API not in this runtime",
  });

  if (process.platform === "win32") {
    const runtimeOk = runtimeMeetsBunMin(Bun.version, WINDOWS_LARGE_ENV_FIX_MIN_BUN);
    const envChars = estimateEnvBlockChars(env);
    const largeEnv = envChars > WINDOWS_ENV_BLOCK_LEGACY_LIMIT;
    checks.push({
      ok: runtimeOk,
      id: "windows.env-block",
      detail: runtimeOk
        ? largeEnv
          ? `env ~${envChars} chars — Bun ${Bun.version} ok (>=${WINDOWS_LARGE_ENV_FIX_MIN_BUN} heap-alloc env block, #32644)`
          : `env ~${envChars} chars — below ${WINDOWS_ENV_BLOCK_LEGACY_LIMIT} legacy cap`
        : `Bun ${Bun.version} — need >=${WINDOWS_LARGE_ENV_FIX_MIN_BUN} on Windows when env is large (BUN-3MAQ; #32644)`,
    });
  }

  const failures = machineCheckFailures(checks);

  return {
    ok: failures.length === 0,
    applicable: true,
    bunfigPath,
    shellPath,
    checks,
  };
}

export function machineCheckWarnings(checks: MachineBunCheck[]): string[] {
  const warnIds = new Set(["frozenLockfile", "minimumReleaseAge", "Bun.secrets"]);
  return checks
    .filter((check) => !check.ok && warnIds.has(check.id))
    .map((check) => `${check.id}: ${check.detail}`);
}

export function machineCheckFailures(checks: MachineBunCheck[]): string[] {
  const warnIds = new Set(["frozenLockfile", "minimumReleaseAge", "Bun.secrets"]);
  return checks
    .filter((check) => !check.ok && !warnIds.has(check.id))
    .map((check) => `${check.id}: ${check.detail}`);
}
