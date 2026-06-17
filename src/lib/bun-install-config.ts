/**
 * Bun install policy — secure defaults vs bunfig.toml [install] and BUN_CONFIG_* env.
 *
 * @see https://bun.com/docs/pm/cli/install#configuring-bun-install-with-bunfig-toml
 */

import { pathExists } from "./bun-io.ts";
import { join } from "path";
import { TOML } from "bun";

export const BUN_INSTALL_DOCS_URL =
  "https://bun.com/docs/pm/cli/install#configuring-bun-install-with-bunfig-toml";

/** Bun global install paths — https://bun.com/docs/pm/cli/add#global */
export const BUN_GLOBAL_INSTALL_PATHS = {
  globalDir: "~/.bun/install/global",
  globalBinDir: "~/.bun/bin",
} as const;

/**
 * Secure toolchain defaults for project bunfig.toml `[install]`.
 * Bun merges $XDG_CONFIG_HOME/.bunfig.toml, $HOME/.bunfig.toml, and ./bunfig.toml;
 * BUN_CONFIG_* env vars override bunfig (higher priority).
 */
export const SECURE_BUN_INSTALL_POLICY = {
  optional: true,
  dev: true,
  peer: true,
  production: false,
  saveTextLockfile: true,
  frozenLockfile: true,
  dryRun: false,
  ignoreScripts: false,
  linker: "isolated",
  ...BUN_GLOBAL_INSTALL_PATHS,
  minimumReleaseAge: 259_200,
  minimumReleaseAgeExcludes: ["@types/bun", "@types/node", "typescript"],
} as const;

export interface BunInstallEnvOverride {
  name: string;
  description: string;
  /** When set, doctor/guardian warns if the variable is present. */
  risky?: boolean;
}

/** Env vars override bunfig.toml — higher priority per Bun docs. */
export const BUN_INSTALL_ENV_VARS: readonly BunInstallEnvOverride[] = [
  { name: "BUN_CONFIG_REGISTRY", description: "npm registry URL" },
  { name: "BUN_CONFIG_TOKEN", description: "auth token (currently no-op in Bun)" },
  { name: "BUN_CONFIG_YARN_LOCKFILE", description: "also write yarn.lock" },
  { name: "BUN_CONFIG_LINK_NATIVE_BINS", description: "platform-specific bin links" },
  {
    name: "BUN_CONFIG_SKIP_SAVE_LOCKFILE",
    description: "do not write bun.lock",
    risky: true,
  },
  {
    name: "BUN_CONFIG_SKIP_LOAD_LOCKFILE",
    description: "ignore existing bun.lock",
    risky: true,
  },
  {
    name: "BUN_CONFIG_SKIP_INSTALL_PACKAGES",
    description: "resolve only — no node_modules writes",
    risky: true,
  },
] as const;

export interface BunfigInstallSection {
  optional?: boolean;
  dev?: boolean;
  peer?: boolean;
  production?: boolean;
  saveTextLockfile?: boolean;
  frozenLockfile?: boolean;
  dryRun?: boolean;
  concurrentScripts?: number;
  ignoreScripts?: boolean;
  linker?: string;
  globalDir?: string;
  globalBinDir?: string;
  minimumReleaseAge?: number;
  minimumReleaseAgeExcludes?: string[];
}

export interface BunInstallConfigAudit {
  docsUrl: string;
  policy: typeof SECURE_BUN_INSTALL_POLICY;
  envOverrides: Array<{ name: string; value: string; risky: boolean }>;
  bunfigPath: string | null;
  bunfigInstall: BunfigInstallSection | null;
  warnings: string[];
  ok: boolean;
}

function activeEnvOverrides(): BunInstallConfigAudit["envOverrides"] {
  const rows: BunInstallConfigAudit["envOverrides"] = [];
  for (const spec of BUN_INSTALL_ENV_VARS) {
    const value = Bun.env[spec.name];
    if (value == null || value === "") continue;
    rows.push({ name: spec.name, value, risky: spec.risky === true });
  }
  return rows;
}

async function readBunfigInstall(projectDir: string): Promise<{
  path: string | null;
  install: BunfigInstallSection | null;
}> {
  const bunfigPath = join(projectDir, "bunfig.toml");
  if (!pathExists(bunfigPath)) return { path: null, install: null };
  try {
    const parsed = TOML.parse(await Bun.file(bunfigPath).text()) as {
      install?: BunfigInstallSection;
    };
    return { path: bunfigPath, install: parsed.install ?? null };
  } catch {
    return { path: bunfigPath, install: null };
  }
}

function auditPolicyDrift(install: BunfigInstallSection | null): string[] {
  const warnings: string[] = [];
  if (!install) {
    warnings.push("missing bunfig.toml [install] — using Bun defaults (weaker than secure policy)");
    return warnings;
  }

  if (install.saveTextLockfile !== SECURE_BUN_INSTALL_POLICY.saveTextLockfile) {
    warnings.push(
      `saveTextLockfile=${String(install.saveTextLockfile)} — secure default is true (text bun.lock for guardian)`
    );
  }
  if (install.frozenLockfile !== SECURE_BUN_INSTALL_POLICY.frozenLockfile) {
    warnings.push(
      `frozenLockfile=${String(install.frozenLockfile)} — secure default is true (reproducible installs)`
    );
  }
  if (install.linker && install.linker !== SECURE_BUN_INSTALL_POLICY.linker) {
    warnings.push(
      `linker=${install.linker} — secure default is isolated (prevents phantom dependencies)`
    );
  }
  if (install.ignoreScripts === true) {
    warnings.push(
      "ignoreScripts=true — blocks even trustedDependencies; use package.json trustedDependencies instead"
    );
  }
  if (install.globalDir && install.globalDir !== SECURE_BUN_INSTALL_POLICY.globalDir) {
    warnings.push(
      `globalDir=${install.globalDir} — expected ${SECURE_BUN_INSTALL_POLICY.globalDir} (bun add -g / bun install -g)`
    );
  }
  if (install.globalBinDir && install.globalBinDir !== SECURE_BUN_INSTALL_POLICY.globalBinDir) {
    warnings.push(
      `globalBinDir=${install.globalBinDir} — expected ${SECURE_BUN_INSTALL_POLICY.globalBinDir}`
    );
  }
  if (!install.globalDir) {
    warnings.push(
      `globalDir unset — add globalDir = "${SECURE_BUN_INSTALL_POLICY.globalDir}" for explicit bun add -g paths`
    );
  }
  if (!install.globalBinDir) {
    warnings.push(
      `globalBinDir unset — add globalBinDir = "${SECURE_BUN_INSTALL_POLICY.globalBinDir}" for explicit global bin path`
    );
  }
  const age = install.minimumReleaseAge;
  if (age == null || age < SECURE_BUN_INSTALL_POLICY.minimumReleaseAge) {
    warnings.push(
      `minimumReleaseAge=${age ?? "unset"} — secure default is ${SECURE_BUN_INSTALL_POLICY.minimumReleaseAge}s (3 days)`
    );
  }

  return warnings;
}

/** Audit install policy: env overrides beat bunfig; flag weak drift from secure defaults. */
export async function auditBunInstallConfig(projectDir: string): Promise<BunInstallConfigAudit> {
  const envOverrides = activeEnvOverrides();
  const { path: bunfigPath, install } = await readBunfigInstall(projectDir);
  const warnings: string[] = [];

  for (const row of envOverrides) {
    if (row.risky) {
      warnings.push(
        `${row.name} is set — overrides bunfig.toml and can break guardian lockfile baselines`
      );
    }
  }

  warnings.push(...auditPolicyDrift(install));

  return {
    docsUrl: BUN_INSTALL_DOCS_URL,
    policy: SECURE_BUN_INSTALL_POLICY,
    envOverrides,
    bunfigPath,
    bunfigInstall: install,
    warnings,
    ok: warnings.length === 0,
  };
}
