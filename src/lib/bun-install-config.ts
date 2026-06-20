/**
 * Bun install policy — grouped tables: official default | hardened | current.
 *
 * @see https://bun.com/docs/pm/cli/install#configuring-bun-install-with-bunfig-toml
 * @see https://bun.com/docs/pm/cli/install#platform-specific-dependencies
 */

import { bunVersion } from "./bun-utils.ts";
import { pathExists } from "./bun-io.ts";
import { join } from "path";
import { TOML } from "bun";

export const BUN_INSTALL_DOC_URL = "https://bun.com/docs/pm/cli/install";
export const BUN_RELEASE_1_3_13_URL = "https://bun.com/blog/bun-v1.3.13";
export const BUN_RELEASE_1_3_13_SOURCE_MAPS_URL =
  "https://bun.com/blog/bun-v1.3.13#source-maps-use-up-to-8x-less-memory";

export function bunInstallDocAnchor(fragment: string): string {
  return `${BUN_INSTALL_DOC_URL}#${fragment}`;
}

export const BUN_INSTALL_DOCS_URL = bunInstallDocAnchor("configuring-bun-install-with-bunfig-toml");

/** Minimum Bun version this policy matrix was validated against. */
export const BUN_INSTALL_POLICY_MIN_BUN = "1.4.0";

/** Last policy-matrix edit (ISO date) — bump when hardened defaults or rows change. */
export const BUN_INSTALL_POLICY_LAST_MODIFIED = "2026-06-20";

/** bunfig / package.json keys that must be explicit under hardened policy. */
export const BUN_INSTALL_REQUIRED_KEYS = new Set([
  "saveTextLockfile",
  "frozenLockfile",
  "linker",
  "minimumReleaseAge",
  "globalDir",
  "globalBinDir",
  "concurrentScripts",
  "cacheDir",
]);

export const BUN_GLOBAL_INSTALL_PATHS = {
  globalDir: "~/.bun/install/global",
  globalBinDir: "~/.bun/bin",
} as const;

export const BUN_INSTALL_CACHE_DIR = "~/.bun/install/cache";

/** Bun fallback flag for disabling streaming tarball extraction during install diagnostics. */
export const BUN_INSTALL_STREAMING_EXTRACT_DISABLE_ENV =
  "BUN_FEATURE_FLAG_DISABLE_STREAMING_INSTALL";
export const BUN_FEATURE_FLAG_NO_ORPHANS_ENV = "BUN_FEATURE_FLAG_NO_ORPHANS";
export const BUN_INSTALL_GLOBAL_STORE_ENV = "BUN_INSTALL_GLOBAL_STORE";
export const BUN_FEATURE_FLAG_DISABLE_BUN_JSX_ENV = "BUN_FEATURE_FLAG_DISABLE_BUN_JSX";
export const BUN_RUNTIME_TRANSPILER_CACHE_PATH_ENV = "BUN_RUNTIME_TRANSPILER_CACHE_PATH";
export const BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT_ENV =
  "BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT";

/**
 * Agent-facing install CLI — SSOT for taxonomy autoFix, drift hints, and guardian output.
 * @see https://bun.com/docs/pm/cli/add#cli-usage
 * @see https://bun.com/docs/pm/cli/update#cli-usage
 */
export const BUN_INSTALL_CLI = {
  reproducible: "bun ci",
  install: "bun install",
  frozenInstall: "bun install --frozen-lockfile",
  add: "bun add <pkg>",
  addDev: "bun add -d <pkg>",
  addExact: "bun add -E <pkg>",
  addTrust: "bun add --trust <pkg>",
  update: "bun update <pkg>",
  updateAll: "bun update",
  updateInteractive: "bun update -i",
  updateLatest: "bun update <pkg> --latest",
  guardianFix: "kimi-guardian fix",
  pmTrust: "bun pm trust <pkg>",
  installFilter: "bun install --filter './examples/<name>'",
  pmListAll: "bun pm ls --all",
} as const;

/** Link root package from an `examples/*` workspace — `workspace:*` does not resolve root names. */
export const BUN_WORKSPACE_ROOT_CONSUMER_LINK = "file:../..";

/** Dep-change commands only (alias for docs that reference DEP_CHANGE_CLI). */
export const DEP_CHANGE_CLI = {
  add: BUN_INSTALL_CLI.add,
  addDev: BUN_INSTALL_CLI.addDev,
  update: BUN_INSTALL_CLI.update,
  updateInteractive: BUN_INSTALL_CLI.updateInteractive,
  addTrust: BUN_INSTALL_CLI.addTrust,
} as const;

export const BUN_DEP_CHANGE_HINT =
  "Dep changes: bun add <pkg> (new) or bun update <pkg> (bump) — not plain bun install under frozenLockfile.";

export const BUN_LOCKFILE_DRIFT_HINT =
  "Lock stale: scripts-only → bun install --frozen-lockfile; dep change → bun add / bun update; baseline → kimi-guardian fix.";

/** Multi-line workflow for guardian report / doctor detail output. */
export function formatInstallCliWorkflow(): string[] {
  return [
    "Install CLI workflow:",
    `  reproducible: ${BUN_INSTALL_CLI.reproducible}`,
    `  add dep:      ${BUN_INSTALL_CLI.add}`,
    `  bump dep:     ${BUN_INSTALL_CLI.update}`,
    `  interactive:  ${BUN_INSTALL_CLI.updateInteractive}`,
    `  lifecycle:    ${BUN_INSTALL_CLI.addTrust}`,
    `  baseline:     ${BUN_INSTALL_CLI.guardianFix}`,
  ];
}

export type BunInstallPolicyGroup =
  | "dependency-scope"
  | "lockfile"
  | "lifecycle"
  | "linker"
  | "global"
  | "supply-chain"
  | "performance"
  | "cache"
  | "workspace"
  | "package-json"
  | "platform"
  | "environment";

export type BunInstallPolicyStatus = "ok" | "drift" | "missing" | "weaker" | "n/a";

export interface BunInstallPolicyRowDef {
  group: BunInstallPolicyGroup;
  key: string;
  type: "boolean" | "number" | "string" | "string[]";
  officialDefault: string;
  hardenedDefault: string;
  bunfigKey: string | null;
  cliFlag: string | null;
  sinceBun: string;
  docsAnchor: string;
  notes: string;
  requireExplicit?: boolean;
  /** ISO date override for property reference LastModified column. */
  lastModified?: string;
}

/** Property reference row — docs / guardian report schema. */
export interface BunInstallPropertyRef {
  property: string;
  type: string;
  default: string;
  required: boolean;
  description: string;
  versionAdded: string;
  lastModified: string;
  docsUrl: string;
}

export interface BunInstallPolicyRow extends BunInstallPolicyRowDef {
  current: string | null;
  status: BunInstallPolicyStatus;
  docsUrl: string;
}

export interface BunInstallVersionInfo {
  runtimeBun: string;
  packageManager: string | null;
  enginesBun: string | null;
  policyMinBun: string;
  docsUrl: string;
}

/** bunfig.toml `[install]` + `[install.cache]` — SSOT row definitions. */
export const BUN_INSTALL_BUNFIG_POLICY: readonly BunInstallPolicyRowDef[] = [
  {
    group: "dependency-scope",
    key: "optional",
    type: "boolean",
    officialDefault: "true",
    hardenedDefault: "true",
    bunfigKey: "[install].optional",
    cliFlag: "--omit=optional",
    sinceBun: "1.0",
    docsAnchor: "configuring-bun-install-with-bunfig-toml",
    notes: "Install optionalDependencies",
  },
  {
    group: "dependency-scope",
    key: "dev",
    type: "boolean",
    officialDefault: "true",
    hardenedDefault: "true",
    bunfigKey: "[install].dev",
    cliFlag: "--omit=dev",
    sinceBun: "1.0",
    docsAnchor: "configuring-bun-install-with-bunfig-toml",
    notes: "Install devDependencies; use --production in CI instead of dev=false",
  },
  {
    group: "dependency-scope",
    key: "peer",
    type: "boolean",
    officialDefault: "true",
    hardenedDefault: "true",
    bunfigKey: "[install].peer",
    cliFlag: "--omit=peer",
    sinceBun: "1.0",
    docsAnchor: "peer-dependencies",
    notes: "Install peerDependencies (Bun default: auto-install peers)",
  },
  {
    group: "dependency-scope",
    key: "production",
    type: "boolean",
    officialDefault: "false",
    hardenedDefault: "false",
    bunfigKey: "[install].production",
    cliFlag: "--production",
    sinceBun: "1.0",
    docsAnchor: "production-mode",
    notes: "Dev workflow false; CI may pass --production or --omit dev",
  },
  {
    group: "lockfile",
    key: "saveTextLockfile",
    type: "boolean",
    officialDefault: "false",
    hardenedDefault: "true",
    bunfigKey: "[install].saveTextLockfile",
    cliFlag: "--save-text-lockfile",
    sinceBun: "1.2",
    docsAnchor: "configuring-bun-install-with-bunfig-toml",
    notes: "Text bun.lock for guardian baselines (Bun default true since 1.2 in practice)",
  },
  {
    group: "lockfile",
    key: "frozenLockfile",
    type: "boolean",
    officialDefault: "false",
    hardenedDefault: "true",
    bunfigKey: "[install].frozenLockfile",
    cliFlag: "--frozen-lockfile / bun ci",
    sinceBun: "1.0",
    docsAnchor: "production-mode",
    notes:
      "Reproducible installs; dep changes via bun add / bun update (not plain bun install); dx.config uses frozen lockfile",
  },
  {
    group: "lockfile",
    key: "dryRun",
    type: "boolean",
    officialDefault: "false",
    hardenedDefault: "false",
    bunfigKey: "[install].dryRun",
    cliFlag: "--dry-run",
    sinceBun: "1.0",
    docsAnchor: "dry-run",
    notes: "Guardian / audit dry-run checks",
  },
  {
    group: "lockfile",
    key: "exact",
    type: "boolean",
    officialDefault: "false",
    hardenedDefault: "false",
    bunfigKey: "[install].exact",
    cliFlag: "bun add -E",
    sinceBun: "1.0",
    docsAnchor: "configuring-bun-install-with-bunfig-toml",
    notes: "Pin exact versions in package.json (use sparingly)",
  },
  {
    group: "lifecycle",
    key: "ignoreScripts",
    type: "boolean",
    officialDefault: "false",
    hardenedDefault: "false",
    bunfigKey: "[install].ignoreScripts",
    cliFlag: "--ignore-scripts",
    sinceBun: "1.0",
    docsAnchor: "lifecycle-scripts",
    notes: "Keep false; dependency scripts use package.json trustedDependencies",
  },
  {
    group: "linker",
    key: "linker",
    type: "string",
    officialDefault: "configVersion-dependent",
    hardenedDefault: "isolated",
    bunfigKey: "[install].linker",
    cliFlag: "--linker=isolated",
    sinceBun: "1.3.2",
    docsAnchor: "installation-strategies",
    notes:
      'Bun defaults to "isolated" for configVersion=1 workspaces, otherwise "hoisted"; hardened policy pins isolated to prevent phantom dependencies and uses Bun 1.3.13+ peer-heavy install fast paths',
  },
  {
    group: "global",
    key: "globalDir",
    type: "string",
    officialDefault: BUN_GLOBAL_INSTALL_PATHS.globalDir,
    hardenedDefault: BUN_GLOBAL_INSTALL_PATHS.globalDir,
    bunfigKey: "[install].globalDir",
    cliFlag: "bun add -g / bun install -g",
    sinceBun: "1.0",
    docsAnchor: "global-packages",
    notes: "Global package store",
    requireExplicit: true,
  },
  {
    group: "global",
    key: "globalBinDir",
    type: "string",
    officialDefault: BUN_GLOBAL_INSTALL_PATHS.globalBinDir,
    hardenedDefault: BUN_GLOBAL_INSTALL_PATHS.globalBinDir,
    bunfigKey: "[install].globalBinDir",
    cliFlag: "bun pm bin -g",
    sinceBun: "1.0",
    docsAnchor: "global-packages",
    notes: "Global CLI bins; kimi also installs ~/.local/bin wrappers",
    requireExplicit: true,
  },
  {
    group: "supply-chain",
    key: "minimumReleaseAge",
    type: "number",
    officialDefault: "0",
    hardenedDefault: "259200",
    bunfigKey: "[install].minimumReleaseAge",
    cliFlag: "--minimum-release-age",
    sinceBun: "1.1",
    docsAnchor: "minimum-release-age",
    notes: "Seconds (3 days); new resolutions only",
  },
  {
    group: "supply-chain",
    key: "minimumReleaseAgeExcludes",
    type: "string[]",
    officialDefault: '["@types/node","typescript"]',
    hardenedDefault: '["@types/bun","@types/node","typescript"]',
    bunfigKey: "[install].minimumReleaseAgeExcludes",
    cliFlag: null,
    sinceBun: "1.1",
    docsAnchor: "minimum-release-age",
    notes: "Packages exempt from age gate",
  },
  {
    group: "performance",
    key: "concurrentScripts",
    type: "number",
    officialDefault: "cpu×2",
    hardenedDefault: "8",
    bunfigKey: "[install].concurrentScripts",
    cliFlag: "--concurrent-scripts",
    sinceBun: "1.0",
    docsAnchor: "lifecycle-scripts",
    notes: "Explicit value for reproducibility across machines",
    requireExplicit: true,
  },
  {
    group: "cache",
    key: "cacheDir",
    type: "string",
    officialDefault: BUN_INSTALL_CACHE_DIR,
    hardenedDefault: BUN_INSTALL_CACHE_DIR,
    bunfigKey: "[install.cache].dir",
    cliFlag: "--cache-dir",
    sinceBun: "1.0",
    docsAnchor: "cache",
    notes: "Global npm tarball cache",
    requireExplicit: true,
  },
] as const;

/** CLI / runtime platform policy — not bunfig defaults. */
export const BUN_INSTALL_PLATFORM_POLICY: readonly BunInstallPolicyRowDef[] = [
  {
    group: "platform",
    key: "installBackend",
    type: "string",
    officialDefault: "clonefile (darwin) / hardlink (linux)",
    hardenedDefault: "platform default",
    bunfigKey: null,
    cliFlag: "--backend",
    sinceBun: "1.0",
    docsAnchor: "platform-specific-backends",
    notes: "clonefile | hardlink | copyfile | symlink",
  },
  {
    group: "platform",
    key: "targetCpu",
    type: "string",
    officialDefault: "runtime arch",
    hardenedDefault: "runtime arch",
    bunfigKey: null,
    cliFlag: "--cpu",
    sinceBun: "1.0",
    docsAnchor: "platform-specific-dependencies",
    notes:
      "Override CPU for platform-specific package selection: arm64 | x64 | ia32 | ppc64 | s390x; lockfile stores normalized cpu — cross-platform without lockfile drift",
  },
  {
    group: "platform",
    key: "targetOs",
    type: "string",
    officialDefault: "runtime os",
    hardenedDefault: "runtime os",
    bunfigKey: null,
    cliFlag: "--os",
    sinceBun: "1.0",
    docsAnchor: "platform-specific-dependencies",
    notes:
      "Override OS for platform-specific package selection: linux | darwin | win32 | freebsd | openbsd | sunos | aix; lockfile stores normalized cpu/os — cross-platform without lockfile drift",
  },
  {
    group: "platform",
    key: "linkNativeBins",
    type: "string",
    officialDefault: "unset",
    hardenedDefault: "unset",
    bunfigKey: null,
    cliFlag: "BUN_CONFIG_LINK_NATIVE_BINS",
    sinceBun: "1.0",
    docsAnchor: "configuring-with-environment-variables",
    notes: "Point bin to platform-specific optional dependency",
  },
] as const;

export const BUN_INSTALL_PACKAGE_POLICY: readonly BunInstallPolicyRowDef[] = [
  {
    group: "package-json",
    key: "trustedDependencies",
    type: "string[]",
    officialDefault: "[]",
    hardenedDefault: "[]",
    bunfigKey: null,
    cliFlag: "bun add --trust / bun pm trust",
    sinceBun: "1.0",
    docsAnchor: "lifecycle-scripts",
    notes: "Bun SSOT for dependency lifecycle scripts (not bunfig.toml)",
  },
  {
    group: "package-json",
    key: "packageManager",
    type: "string",
    officialDefault: "unset",
    hardenedDefault: `bun@${BUN_INSTALL_POLICY_MIN_BUN}`,
    bunfigKey: null,
    cliFlag: null,
    sinceBun: "1.0",
    docsAnchor: "configuring-bun-install-with-bunfig-toml",
    notes: "Corepack-style pin; align with engines.bun",
  },
] as const;

/** package.json workspace layout — Path A (`examples/*` only; templates stay scaffolding). */
export const BUN_INSTALL_WORKSPACE_POLICY: readonly BunInstallPolicyRowDef[] = [
  {
    group: "workspace",
    key: "workspaces",
    type: "string[]",
    officialDefault: "unset",
    hardenedDefault: '["examples/*"]',
    bunfigKey: null,
    cliFlag: "bun install --filter",
    sinceBun: "1.0",
    docsAnchor: "workspaces",
    notes:
      "Register runnable examples only; root scripts/postinstall stay at repo root; verify with bun pm ls --all",
    lastModified: "2026-06-20",
  },
  {
    group: "workspace",
    key: "rootConsumerLink",
    type: "string",
    officialDefault: "workspace:*",
    hardenedDefault: BUN_WORKSPACE_ROOT_CONSUMER_LINK,
    bunfigKey: null,
    cliFlag: null,
    sinceBun: "1.0",
    docsAnchor: "workspaces",
    notes:
      "examples/dashboard → kimi-toolchain: use file:../.. — Bun workspace:* only matches workspace globs, not the root package name",
    lastModified: "2026-06-20",
  },
] as const;

/** CLI workflow entries for the property reference table (not bunfig keys). */
export const BUN_INSTALL_CLI_PROPERTY_REFS: readonly BunInstallPropertyRef[] = [
  {
    property: "cli.reproducible",
    type: "command",
    default: BUN_INSTALL_CLI.reproducible,
    required: false,
    description: "Reproducible install from lock (CI / fresh clone)",
    versionAdded: "1.0",
    lastModified: BUN_INSTALL_POLICY_LAST_MODIFIED,
    docsUrl: bunInstallDocAnchor("production-mode"),
  },
  {
    property: "cli.add",
    type: "command",
    default: BUN_INSTALL_CLI.add,
    required: false,
    description: "Add new dependency under frozenLockfile (updates package.json + bun.lock)",
    versionAdded: "1.0",
    lastModified: BUN_INSTALL_POLICY_LAST_MODIFIED,
    docsUrl: "https://bun.com/docs/pm/cli/add#cli-usage",
  },
  {
    property: "cli.update",
    type: "command",
    default: BUN_INSTALL_CLI.update,
    required: false,
    description: "Bump existing dependency within semver range",
    versionAdded: "1.0",
    lastModified: BUN_INSTALL_POLICY_LAST_MODIFIED,
    docsUrl: "https://bun.com/docs/pm/cli/update#cli-usage",
  },
  {
    property: "cli.updateInteractive",
    type: "command",
    default: BUN_INSTALL_CLI.updateInteractive,
    required: false,
    description: "Interactive outdated-package picker",
    versionAdded: "1.1",
    lastModified: BUN_INSTALL_POLICY_LAST_MODIFIED,
    docsUrl: "https://bun.com/docs/pm/cli/update#interactive",
  },
  {
    property: "cli.addTrust",
    type: "command",
    default: BUN_INSTALL_CLI.addTrust,
    required: false,
    description: "Add dep and append to trustedDependencies for lifecycle scripts",
    versionAdded: "1.0",
    lastModified: BUN_INSTALL_POLICY_LAST_MODIFIED,
    docsUrl: bunInstallDocAnchor("lifecycle-scripts"),
  },
  {
    property: "cli.guardianFix",
    type: "command",
    default: BUN_INSTALL_CLI.guardianFix,
    required: false,
    description: "Refresh guardian lockfile baseline after legitimate lock change",
    versionAdded: "1.0",
    lastModified: BUN_INSTALL_POLICY_LAST_MODIFIED,
    docsUrl: BUN_INSTALL_DOCS_URL,
  },
  {
    property: "cli.installFilter",
    type: "command",
    default: BUN_INSTALL_CLI.installFilter,
    required: false,
    description: "Scoped install for one workspace member (name or path; ! prefix excludes)",
    versionAdded: "1.0",
    lastModified: BUN_INSTALL_POLICY_LAST_MODIFIED,
    docsUrl: "https://bun.com/docs/pm/workspaces",
  },
  {
    property: "cli.pmListAll",
    type: "command",
    default: BUN_INSTALL_CLI.pmListAll,
    required: false,
    description: "List lockfile tree including workspace members (@workspace:examples/…)",
    versionAdded: "1.0",
    lastModified: BUN_INSTALL_POLICY_LAST_MODIFIED,
    docsUrl: "https://bun.com/docs/cli/pm",
  },
] as const;

/** @deprecated Use BUN_INSTALL_BUNFIG_POLICY — kept for tests and external readers. */
export const BUN_INSTALL_POLICY_MATRIX = BUN_INSTALL_BUNFIG_POLICY.map((row) => ({
  key: row.key,
  type: row.type,
  official: row.officialDefault === "cpu×2" ? "cpu × 2" : parseDisplayValue(row.officialDefault),
  hardened: parseDisplayValue(row.hardenedDefault),
  notes: row.notes,
}));

/** Hardened values keyed for programmatic access. */
export const SECURE_BUN_INSTALL_POLICY = {
  optional: true,
  dev: true,
  peer: true,
  production: false,
  saveTextLockfile: true,
  frozenLockfile: true,
  dryRun: false,
  exact: false,
  ignoreScripts: false,
  concurrentScripts: 8,
  linker: "isolated",
  ...BUN_GLOBAL_INSTALL_PATHS,
  cacheDir: BUN_INSTALL_CACHE_DIR,
  minimumReleaseAge: 259_200,
  minimumReleaseAgeExcludes: ["@types/bun", "@types/node", "typescript"],
} as const;

export const BUN_INSTALL_POLICY_GROUP_ORDER: readonly BunInstallPolicyGroup[] = [
  "dependency-scope",
  "lockfile",
  "lifecycle",
  "linker",
  "global",
  "supply-chain",
  "performance",
  "cache",
  "workspace",
  "package-json",
  "platform",
  "environment",
];

export const BUN_INSTALL_POLICY_GROUP_LABELS: Record<BunInstallPolicyGroup, string> = {
  "dependency-scope": "Dependency scope",
  lockfile: "Lockfile",
  lifecycle: "Lifecycle scripts",
  linker: "Linker strategy",
  global: "Global installs",
  "supply-chain": "Supply chain",
  performance: "Performance",
  cache: "Cache",
  workspace: "Workspace / package manager",
  "package-json": "package.json",
  platform: "Platform-specific",
  environment: "Environment overrides",
};

export interface BunInstallEnvRow {
  name: string;
  description: string;
  officialDefault: string;
  current: string | null;
  priority: "higher priority than bunfig.toml";
  risky?: boolean;
  diagnostic?: boolean;
}

export const BUN_INSTALL_ENV_VARS: readonly {
  name: string;
  description: string;
  risky?: boolean;
  diagnostic?: boolean;
}[] = [
  { name: "BUN_CONFIG_REGISTRY", description: "npm registry URL" },
  { name: "BUN_CONFIG_TOKEN", description: "auth token (currently no-op in Bun)" },
  { name: "BUN_CONFIG_YARN_LOCKFILE", description: "also write yarn.lock" },
  { name: "BUN_CONFIG_LINK_NATIVE_BINS", description: "platform-specific bin links" },
  {
    name: BUN_INSTALL_STREAMING_EXTRACT_DISABLE_ENV,
    description: "disable Bun install streaming extraction fallback",
    diagnostic: true,
  },
  {
    name: "BUN_CONFIG_SKIP_SAVE_LOCKFILE",
    description: "don't save a lockfile",
    risky: true,
  },
  {
    name: "BUN_CONFIG_SKIP_LOAD_LOCKFILE",
    description: "don't load a lockfile",
    risky: true,
  },
  {
    name: "BUN_CONFIG_SKIP_INSTALL_PACKAGES",
    description: "don't install any packages; useful for bun-create dry bootstrap probes",
    risky: true,
  },
] as const;

/** Bun install env vars from the official "Configuring with environment variables" table. */
export const BUN_INSTALL_OFFICIAL_ENV_VAR_NAMES = [
  "BUN_CONFIG_REGISTRY",
  "BUN_CONFIG_TOKEN",
  "BUN_CONFIG_YARN_LOCKFILE",
  "BUN_CONFIG_LINK_NATIVE_BINS",
  "BUN_CONFIG_SKIP_SAVE_LOCKFILE",
  "BUN_CONFIG_SKIP_LOAD_LOCKFILE",
  "BUN_CONFIG_SKIP_INSTALL_PACKAGES",
] as const;

export interface BunfigInstallSection {
  optional?: boolean;
  dev?: boolean;
  peer?: boolean;
  production?: boolean;
  saveTextLockfile?: boolean;
  frozenLockfile?: boolean;
  dryRun?: boolean;
  exact?: boolean;
  concurrentScripts?: number;
  ignoreScripts?: boolean;
  linker?: string;
  globalDir?: string;
  globalBinDir?: string;
  minimumReleaseAge?: number;
  minimumReleaseAgeExcludes?: string[];
  globalStore?: boolean;
  cache?: { dir?: string };
  registry?: string | { url?: string };
}

interface PackageJsonInstallMeta {
  name?: string;
  packageManager?: string;
  engines?: { bun?: string };
  trustedDependencies?: string[];
  workspaces?: string[];
}

export interface BunInstallConfigAudit {
  schemaVersion: 1;
  docsUrl: string;
  versions: BunInstallVersionInfo;
  runtimeCapabilities: BunInstallRuntimeCapabilities;
  runtimeEnvironment: BunInstallRuntimeEnvironment;
  runtimeEnvironmentAdvisories: string[];
  tables: Record<BunInstallPolicyGroup, BunInstallPolicyRow[]>;
  envRows: BunInstallEnvRow[];
  policy: typeof SECURE_BUN_INSTALL_POLICY;
  envOverrides: Array<{ name: string; value: string; risky: boolean; diagnostic: boolean }>;
  bunfigPath: string | null;
  bunfigInstall: BunfigInstallSection | null;
  warnings: string[];
  ok: boolean;
}

export interface BunInstallRuntimeCapabilities {
  streamingExtraction: {
    status: "enabled" | "disabled";
    enabled: boolean;
    disableEnv: typeof BUN_INSTALL_STREAMING_EXTRACT_DISABLE_ENV;
    disableEnvValue: string | null;
    notes: string;
  };
  isolatedLinkerFastPath: {
    status: "active" | "inactive";
    active: boolean;
    linker: string | null;
    cliFlag: "--linker=isolated";
    releaseUrl: typeof BUN_RELEASE_1_3_13_URL;
    notes: string;
  };
  sourceMapsMemory: {
    status: "optimized";
    releaseUrl: typeof BUN_RELEASE_1_3_13_SOURCE_MAPS_URL;
    notes: string;
  };
  parallelConsole: {
    status: "buffered";
    appliesTo: "bun test --parallel";
    flush: "per-file atomic";
    streams: readonly ["console.log", "console.error"];
    notes: string;
  };
  platformTargeting: {
    cpu: string;
    os: string;
    lockfileBehavior: "normalized cpu/os stored; skipped if disabled for target";
    crossInstall: {
      status: "configured" | "not configured";
      flags: { "--cpu": string | null; "--os": string | null };
      supportedCpu: readonly string[];
      supportedOs: readonly string[];
    };
    ciImplications: "lockfile stable across matrix jobs; install subset varies by runner";
  };
}

export interface BunInstallRuntimeEnvironment {
  noOrphans: {
    status: "active" | "inactive";
    env: typeof BUN_FEATURE_FLAG_NO_ORPHANS_ENV;
    value: string | null;
    parentValue: string | null;
    appliedTo: "spawned processes (non-Windows)";
    source: "src/lib/bun-spawn-env.ts";
  };
  globalStore: {
    status: "configured" | "default";
    env: typeof BUN_INSTALL_GLOBAL_STORE_ENV;
    value: string | null;
    bunfigValue: boolean | null;
    documented: "docs/references/bun-runtime-scaffold.md";
    note: string;
  };
  jsxDisable: {
    status: "disabled" | "enabled";
    env: typeof BUN_FEATURE_FLAG_DISABLE_BUN_JSX_ENV;
    value: string | null;
    policy: "Bun JSX transform enabled by default";
  };
  transpilerCache: {
    status: "configured" | "snapshot-only";
    env: typeof BUN_RUNTIME_TRANSPILER_CACHE_PATH_ENV;
    value: string | null;
    warning: "No policy row; only captured in src/lib/snapshot-core.ts";
    recommendation: "Add to this audit or formalize in bun-runtime-scaffold.md";
  };
  experimentalHttp2Client: {
    status: "enabled" | "advisor-only";
    env: typeof BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT_ENV;
    value: string | null;
    source: "src/lib/upgrade-advisor.ts";
    policy: "advisor-only until adopted";
  };
}

function parseDisplayValue(raw: string): string | number | boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}

function formatDisplayValue(value: unknown): string {
  if (value == null) return "unset";
  if (Array.isArray(value)) return JSON.stringify(value);
  return String(value);
}

function defaultInstallBackend(): string {
  if (process.platform === "darwin") return "clonefile";
  if (process.platform === "linux") return "hardlink";
  return "copyfile";
}

function resolveBunfigCurrent(
  key: string,
  install: BunfigInstallSection | null,
  cacheDir: string | null
): string | null {
  if (!install && key !== "cacheDir") return null;
  switch (key) {
    case "cacheDir":
      return cacheDir;
    case "minimumReleaseAgeExcludes":
      return install?.minimumReleaseAgeExcludes
        ? JSON.stringify(install.minimumReleaseAgeExcludes)
        : null;
    default: {
      const value = install?.[key as keyof BunfigInstallSection];
      if (value == null) return null;
      return formatDisplayValue(value);
    }
  }
}

function comparePolicyStatus(
  def: BunInstallPolicyRowDef,
  current: string | null
): BunInstallPolicyStatus {
  if (current == null) {
    return def.requireExplicit ? "missing" : "weaker";
  }
  if (current === def.hardenedDefault) return "ok";
  if (def.hardenedDefault === "runtime arch" || def.hardenedDefault === "platform default") {
    return "n/a";
  }
  return "drift";
}

function resolvePlatformCurrent(key: string): string {
  switch (key) {
    case "installBackend":
      return `${process.platform} → ${defaultInstallBackend()}`;
    case "targetCpu":
      return process.arch;
    case "targetOs":
      return process.platform;
    case "linkNativeBins":
      return Bun.env.BUN_CONFIG_LINK_NATIVE_BINS ?? "unset";
    default:
      return "unset";
  }
}

async function readProjectInstallMeta(projectDir: string): Promise<{
  bunfigPath: string | null;
  install: BunfigInstallSection | null;
  cacheDir: string | null;
  packageMeta: PackageJsonInstallMeta | null;
}> {
  const bunfigPath = join(projectDir, "bunfig.toml");
  let install: BunfigInstallSection | null = null;
  let cacheDir: string | null = null;

  if (pathExists(bunfigPath)) {
    try {
      const parsed = TOML.parse(await Bun.file(bunfigPath).text()) as {
        install?: BunfigInstallSection;
      };
      install = parsed.install ?? null;
      cacheDir = install?.cache?.dir ?? null;
    } catch {
      install = null;
    }
  }

  const pkgPath = join(projectDir, "package.json");
  const packageMeta = pathExists(pkgPath)
    ? ((await Bun.file(pkgPath).json()) as PackageJsonInstallMeta)
    : null;

  return {
    bunfigPath: pathExists(bunfigPath) ? bunfigPath : null,
    install,
    cacheDir,
    packageMeta,
  };
}

function resolvePackageCurrent(key: string, meta: PackageJsonInstallMeta | null): string | null {
  if (!meta) return null;
  if (key === "trustedDependencies") {
    return JSON.stringify(meta.trustedDependencies ?? []);
  }
  if (key === "packageManager") {
    return meta.packageManager ?? null;
  }
  if (key === "workspaces") {
    return JSON.stringify(meta.workspaces ?? []);
  }
  return null;
}

async function resolveWorkspaceCurrent(
  key: string,
  projectDir: string,
  packageMeta: PackageJsonInstallMeta | null
): Promise<string | null> {
  if (key === "workspaces") {
    return resolvePackageCurrent("workspaces", packageMeta);
  }
  if (key === "rootConsumerLink") {
    const dashboardPkg = join(projectDir, "examples/dashboard/package.json");
    if (!pathExists(dashboardPkg)) return null;
    try {
      const parsed = (await Bun.file(dashboardPkg).json()) as {
        dependencies?: Record<string, string>;
      };
      return parsed.dependencies?.["kimi-toolchain"] ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

function buildPolicyRows(
  defs: readonly BunInstallPolicyRowDef[],
  install: BunfigInstallSection | null,
  cacheDir: string | null,
  packageMeta: PackageJsonInstallMeta | null,
  workspaceCurrent?: (key: string) => string | null
): BunInstallPolicyRow[] {
  return defs.map((def) => {
    let current: string | null = null;
    if (def.group === "platform") {
      current = resolvePlatformCurrent(def.key);
    } else if (def.group === "package-json") {
      current = resolvePackageCurrent(def.key, packageMeta);
    } else if (def.group === "workspace") {
      current = workspaceCurrent?.(def.key) ?? null;
    } else {
      current = resolveBunfigCurrent(def.key, install, cacheDir);
    }

    const status =
      def.group === "platform"
        ? ("n/a" as const)
        : def.group === "package-json" && def.key === "packageManager"
          ? current === def.hardenedDefault || current?.startsWith("bun@")
            ? ("ok" as const)
            : current == null
              ? ("missing" as const)
              : ("drift" as const)
          : comparePolicyStatus(def, current);

    return {
      ...def,
      current,
      status,
      docsUrl: bunInstallDocAnchor(def.docsAnchor),
    };
  });
}

function buildEnvRows(): BunInstallEnvRow[] {
  return BUN_INSTALL_ENV_VARS.map((spec) => ({
    name: spec.name,
    description: spec.description,
    officialDefault: "unset",
    current: Bun.env[spec.name] ?? null,
    priority: "higher priority than bunfig.toml",
    risky: spec.risky,
    diagnostic: spec.diagnostic,
  }));
}

function buildRuntimeCapabilities(
  install: BunfigInstallSection | null
): BunInstallRuntimeCapabilities {
  const disableEnvValue = Bun.env[BUN_INSTALL_STREAMING_EXTRACT_DISABLE_ENV] ?? null;
  const streamingDisabled = disableEnvValue === "1";
  const linker = install?.linker ?? null;
  const isolatedActive = linker === "isolated";

  return {
    streamingExtraction: {
      status: streamingDisabled ? "disabled" : "enabled",
      enabled: !streamingDisabled,
      disableEnv: BUN_INSTALL_STREAMING_EXTRACT_DISABLE_ENV,
      disableEnvValue,
      notes:
        "Bun streams package tarball extraction by default; set the fallback env to 1 only when diagnosing install extraction regressions.",
    },
    isolatedLinkerFastPath: {
      status: isolatedActive ? "active" : "inactive",
      active: isolatedActive,
      linker,
      cliFlag: "--linker=isolated",
      releaseUrl: BUN_RELEASE_1_3_13_URL,
      notes:
        "Bun 1.3.13+ accelerates peer-heavy installs with the isolated linker while preserving the final .bun store layout.",
    },
    sourceMapsMemory: {
      status: "optimized",
      releaseUrl: BUN_RELEASE_1_3_13_SOURCE_MAPS_URL,
      notes:
        "Bun 1.3.13+ stores source maps in a compact bit-packed format instead of the older Mapping.List representation, reducing memory pressure for large maps during stack lookups and compiled-binary startup.",
    },
    parallelConsole: {
      status: "buffered",
      appliesTo: "bun test --parallel",
      flush: "per-file atomic",
      streams: ["console.log", "console.error"],
      notes:
        "Bun buffers console output per test file under --parallel and flushes each file atomically so concurrent files do not interleave.",
    },
    platformTargeting: {
      cpu: process.arch,
      os: process.platform,
      lockfileBehavior: "normalized cpu/os stored; skipped if disabled for target",
      crossInstall: {
        status: Bun.env.BUN_CONFIG_SKIP_INSTALL_PACKAGES
          ? ("not configured" as const)
          : ("not configured" as const),
        flags: { "--cpu": null, "--os": null },
        supportedCpu: ["arm64", "x64", "ia32", "ppc64", "s390x"],
        supportedOs: ["linux", "darwin", "win32", "freebsd", "openbsd", "sunos", "aix"],
      },
      ciImplications: "lockfile stable across matrix jobs; install subset varies by runner",
    },
  };
}

function buildRuntimeEnvironment(
  install: BunfigInstallSection | null
): BunInstallRuntimeEnvironment {
  const noOrphansParentValue = Bun.env[BUN_FEATURE_FLAG_NO_ORPHANS_ENV] ?? null;
  const noOrphansActive = process.platform !== "win32";
  const globalStoreEnvValue = Bun.env[BUN_INSTALL_GLOBAL_STORE_ENV] ?? null;
  const bunfigGlobalStore = install?.globalStore ?? null;
  const globalStoreConfigured = globalStoreEnvValue != null || bunfigGlobalStore === true;
  const transpilerCacheValue = Bun.env[BUN_RUNTIME_TRANSPILER_CACHE_PATH_ENV] ?? null;
  const http2Value = Bun.env[BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT_ENV] ?? null;

  return {
    noOrphans: {
      status: noOrphansActive ? "active" : "inactive",
      env: BUN_FEATURE_FLAG_NO_ORPHANS_ENV,
      value: noOrphansActive ? "1" : noOrphansParentValue,
      parentValue: noOrphansParentValue,
      appliedTo: "spawned processes (non-Windows)",
      source: "src/lib/bun-spawn-env.ts",
    },
    globalStore: {
      status: globalStoreConfigured ? "configured" : "default",
      env: BUN_INSTALL_GLOBAL_STORE_ENV,
      value: globalStoreEnvValue,
      bunfigValue: bunfigGlobalStore,
      documented: "docs/references/bun-runtime-scaffold.md",
      note: "global virtual store toggle for isolated linker warm installs",
    },
    jsxDisable: {
      status: Bun.env[BUN_FEATURE_FLAG_DISABLE_BUN_JSX_ENV] === "1" ? "disabled" : "enabled",
      env: BUN_FEATURE_FLAG_DISABLE_BUN_JSX_ENV,
      value: Bun.env[BUN_FEATURE_FLAG_DISABLE_BUN_JSX_ENV] ?? null,
      policy: "Bun JSX transform enabled by default",
    },
    transpilerCache: {
      status: transpilerCacheValue ? "configured" : "snapshot-only",
      env: BUN_RUNTIME_TRANSPILER_CACHE_PATH_ENV,
      value: transpilerCacheValue,
      warning: "No policy row; only captured in src/lib/snapshot-core.ts",
      recommendation: "Add to this audit or formalize in bun-runtime-scaffold.md",
    },
    experimentalHttp2Client: {
      status: http2Value === "1" ? "enabled" : "advisor-only",
      env: BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT_ENV,
      value: http2Value,
      source: "src/lib/upgrade-advisor.ts",
      policy: "advisor-only until adopted",
    },
  };
}

function runtimeEnvironmentAdvisories(runtimeEnvironment: BunInstallRuntimeEnvironment): string[] {
  const advisories: string[] = [];
  if (runtimeEnvironment.transpilerCache.status === "snapshot-only") {
    advisories.push(
      `${BUN_RUNTIME_TRANSPILER_CACHE_PATH_ENV} is snapshot-only, not policy-audited`
    );
  }
  if (runtimeEnvironment.experimentalHttp2Client.status === "advisor-only") {
    advisories.push(
      `${BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT_ENV} is advisor-only until adopted`
    );
  }
  return advisories;
}

function rowWarnings(row: BunInstallPolicyRow): string[] {
  if (row.status === "ok" || row.status === "n/a") return [];
  if (row.status === "missing") {
    return [
      `${row.key} unset — hardened ${row.hardenedDefault} (${row.bunfigKey ?? row.cliFlag ?? row.key})`,
    ];
  }
  if (row.status === "weaker") {
    return [`${row.key} unset — using Bun official default ${row.officialDefault}`];
  }
  if (row.key === "ignoreScripts" && row.current === "true") {
    return ["ignoreScripts=true — blocks trustedDependencies"];
  }
  return [`${row.key}=${row.current ?? "unset"} — hardened ${row.hardenedDefault}`];
}

/** Build grouped install policy tables with official | hardened | current | status. */
export async function buildInstallPolicyReport(projectDir: string): Promise<BunInstallConfigAudit> {
  const { bunfigPath, install, cacheDir, packageMeta } = await readProjectInstallMeta(projectDir);

  const isToolchainRoot = packageMeta?.name === "kimi-toolchain";
  const workspaceRows = isToolchainRoot
    ? await (async () => {
        const rows = buildPolicyRows(
          BUN_INSTALL_WORKSPACE_POLICY,
          install,
          cacheDir,
          packageMeta,
          (key) => {
            if (key === "workspaces") return resolvePackageCurrent("workspaces", packageMeta);
            return null;
          }
        );
        for (const row of rows) {
          if (row.key === "rootConsumerLink") {
            row.current = await resolveWorkspaceCurrent(
              "rootConsumerLink",
              projectDir,
              packageMeta
            );
            row.status = comparePolicyStatus(row, row.current);
          }
        }
        return rows;
      })()
    : BUN_INSTALL_WORKSPACE_POLICY.map((def) => ({
        ...def,
        current: null,
        status: "n/a" as const,
        docsUrl: bunInstallDocAnchor(def.docsAnchor),
      }));
  const bunfigRows = buildPolicyRows(BUN_INSTALL_BUNFIG_POLICY, install, cacheDir, packageMeta);
  const packageRows = buildPolicyRows(BUN_INSTALL_PACKAGE_POLICY, install, cacheDir, packageMeta);
  const platformRows = buildPolicyRows(BUN_INSTALL_PLATFORM_POLICY, install, cacheDir, packageMeta);
  const envRows = buildEnvRows();
  const runtimeCapabilities = buildRuntimeCapabilities(install);
  const runtimeEnvironment = buildRuntimeEnvironment(install);
  const runtimeEnvironmentAdvisoryRows = runtimeEnvironmentAdvisories(runtimeEnvironment);

  const envOverrides = envRows
    .filter((row) => row.current != null && row.current !== "")
    .map((row) => ({
      name: row.name,
      value: row.current!,
      risky: row.risky === true,
      diagnostic: row.diagnostic === true,
    }));

  const warnings: string[] = [];
  for (const row of envOverrides) {
    if (row.risky) {
      warnings.push(
        `${row.name} is set — overrides bunfig.toml and can break guardian lockfile baselines`
      );
    }
  }
  if (!install) {
    warnings.push("missing bunfig.toml [install] — using Bun defaults (weaker than secure policy)");
  }
  for (const row of [...bunfigRows, ...packageRows, ...workspaceRows]) {
    warnings.push(...rowWarnings(row));
  }

  const tables: BunInstallConfigAudit["tables"] = {
    "dependency-scope": bunfigRows.filter((r) => r.group === "dependency-scope"),
    lockfile: bunfigRows.filter((r) => r.group === "lockfile"),
    lifecycle: bunfigRows.filter((r) => r.group === "lifecycle"),
    linker: bunfigRows.filter((r) => r.group === "linker"),
    global: bunfigRows.filter((r) => r.group === "global"),
    "supply-chain": bunfigRows.filter((r) => r.group === "supply-chain"),
    performance: bunfigRows.filter((r) => r.group === "performance"),
    cache: bunfigRows.filter((r) => r.group === "cache"),
    workspace: workspaceRows,
    "package-json": packageRows,
    platform: platformRows,
    environment: [],
  };

  const versions: BunInstallVersionInfo = {
    runtimeBun: bunVersion(),
    packageManager: packageMeta?.packageManager ?? null,
    enginesBun: packageMeta?.engines?.bun ?? null,
    policyMinBun: BUN_INSTALL_POLICY_MIN_BUN,
    docsUrl: BUN_INSTALL_DOC_URL,
  };

  return {
    schemaVersion: 1,
    docsUrl: BUN_INSTALL_DOCS_URL,
    versions,
    runtimeCapabilities,
    runtimeEnvironment,
    runtimeEnvironmentAdvisories: runtimeEnvironmentAdvisoryRows,
    tables,
    envRows,
    policy: SECURE_BUN_INSTALL_POLICY,
    envOverrides,
    bunfigPath,
    bunfigInstall: install,
    warnings,
    ok: warnings.length === 0,
  };
}

export function formatInstallPolicyTable(
  rows: BunInstallPolicyRow[],
  options?: { maxKeyWidth?: number }
): string[] {
  const keyWidth = options?.maxKeyWidth ?? Math.max(8, ...rows.map((r) => r.key.length));
  const header = `${"Key".padEnd(keyWidth)}  Official        Hardened        Current         St`;
  const lines = [header, "-".repeat(header.length)];
  for (const row of rows) {
    const line = [
      row.key.padEnd(keyWidth),
      truncate(row.officialDefault, 15).padEnd(15),
      truncate(row.hardenedDefault, 15).padEnd(15),
      truncate(row.current ?? "unset", 15).padEnd(15),
      row.status,
    ].join("  ");
    lines.push(line);
  }
  return lines;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max - 1) + "…";
}

function isPolicyRowRequired(row: BunInstallPolicyRowDef): boolean {
  return row.requireExplicit === true || BUN_INSTALL_REQUIRED_KEYS.has(row.key);
}

/** Map policy row to property-reference schema (Bun official default + hardened in description). */
export function policyRowToPropertyRef(row: BunInstallPolicyRowDef): BunInstallPropertyRef {
  const property = row.bunfigKey ?? row.key;
  const hardenedNote =
    row.hardenedDefault !== row.officialDefault ? ` Hardened: ${row.hardenedDefault}.` : "";
  const cliNote = row.cliFlag ? ` CLI: ${row.cliFlag}.` : "";
  return {
    property,
    type: row.type,
    default: row.officialDefault,
    required: isPolicyRowRequired(row),
    description: `${row.notes}.${hardenedNote}${cliNote}`.replace(/\.\.+/g, "."),
    versionAdded: row.sinceBun,
    lastModified: row.lastModified ?? BUN_INSTALL_POLICY_LAST_MODIFIED,
    docsUrl: bunInstallDocAnchor(row.docsAnchor),
  };
}

/** All bunfig + package.json property references in stable order. */
export function collectInstallPropertyReferences(): BunInstallPropertyRef[] {
  const rows = [
    ...BUN_INSTALL_BUNFIG_POLICY,
    ...BUN_INSTALL_WORKSPACE_POLICY,
    ...BUN_INSTALL_PACKAGE_POLICY,
  ];
  return [...rows.map(policyRowToPropertyRef), ...BUN_INSTALL_CLI_PROPERTY_REFS];
}

const INSTALL_PROPERTY_REF_HEADER =
  "| Property | Type | Default | Required | Description | VersionAdded | LastModified |";

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/** Markdown table: Property | Type | Default | Required | Description | VersionAdded | LastModified */
export function formatInstallPropertyReferenceTable(
  refs: readonly BunInstallPropertyRef[] = collectInstallPropertyReferences()
): string[] {
  const lines = [INSTALL_PROPERTY_REF_HEADER, "| --- | --- | --- | --- | --- | --- | --- |"];
  for (const ref of refs) {
    lines.push(
      `| ${escapeMarkdownCell(ref.property)} | ${ref.type} | ${escapeMarkdownCell(ref.default)} | ${ref.required ? "yes" : "no"} | ${escapeMarkdownCell(ref.description)} | ${ref.versionAdded} | ${ref.lastModified} |`
    );
  }
  return lines;
}

/** Format full report for guardian / doctor human output. */
export function formatInstallPolicyReport(report: BunInstallConfigAudit): string[] {
  const lines: string[] = [
    `Bun ${report.versions.runtimeBun} | policy≥${report.versions.policyMinBun} | packageManager=${report.versions.packageManager ?? "unset"} | engines.bun=${report.versions.enginesBun ?? "unset"}`,
    `Docs: ${report.versions.docsUrl}`,
    "Install runtime:",
    `  streamingExtraction: ${report.runtimeCapabilities.streamingExtraction.status} (disable: ${report.runtimeCapabilities.streamingExtraction.disableEnv}=1)`,
    `  isolatedLinkerFastPath: ${report.runtimeCapabilities.isolatedLinkerFastPath.status} (${report.runtimeCapabilities.isolatedLinkerFastPath.cliFlag}; current=${report.runtimeCapabilities.isolatedLinkerFastPath.linker ?? "unset"})`,
    `  sourceMapsMemory: ${report.runtimeCapabilities.sourceMapsMemory.status} (Bun 1.3.13+ compact maps)`,
    `  parallelConsole: ${report.runtimeCapabilities.parallelConsole.status} (${report.runtimeCapabilities.parallelConsole.flush})`,
    `  platformTargeting: ${report.runtimeCapabilities.platformTargeting.crossInstall.status} (${report.runtimeCapabilities.platformTargeting.cpu}/${report.runtimeCapabilities.platformTargeting.os})`,
    "Runtime environment:",
    `  noOrphans: ${report.runtimeEnvironment.noOrphans.status} (${report.runtimeEnvironment.noOrphans.env}=${report.runtimeEnvironment.noOrphans.value ?? "unset"})`,
    `  globalStore: ${report.runtimeEnvironment.globalStore.status} (${report.runtimeEnvironment.globalStore.env}=${report.runtimeEnvironment.globalStore.value ?? "unset"}; bunfig=${report.runtimeEnvironment.globalStore.bunfigValue ?? "unset"})`,
    `  jsxTransform: ${report.runtimeEnvironment.jsxDisable.status} (${report.runtimeEnvironment.jsxDisable.env}=${report.runtimeEnvironment.jsxDisable.value ?? "unset"})`,
    `  transpilerCache: ${report.runtimeEnvironment.transpilerCache.status} (${report.runtimeEnvironment.transpilerCache.env}=${report.runtimeEnvironment.transpilerCache.value ?? "unset"})`,
    `  experimentalHttp2Client: ${report.runtimeEnvironment.experimentalHttp2Client.status} (${report.runtimeEnvironment.experimentalHttp2Client.env}=${report.runtimeEnvironment.experimentalHttp2Client.value ?? "unset"})`,
    "",
  ];

  for (const group of BUN_INSTALL_POLICY_GROUP_ORDER) {
    const rows =
      group === "environment"
        ? report.envRows.map(
            (env) =>
              ({
                group: "environment",
                key: env.name,
                type: "string",
                officialDefault: env.officialDefault,
                hardenedDefault: "unset",
                current: env.current,
                status: env.risky && env.current ? "drift" : env.current ? "n/a" : "ok",
                bunfigKey: null,
                cliFlag: null,
                sinceBun: "1.0",
                docsAnchor: "configuring-with-environment-variables",
                notes: env.description,
                docsUrl: bunInstallDocAnchor("configuring-with-environment-variables"),
              }) satisfies BunInstallPolicyRow
          )
        : report.tables[group];
    if (rows.length === 0) continue;
    lines.push(`## ${BUN_INSTALL_POLICY_GROUP_LABELS[group]}`);
    lines.push(...formatInstallPolicyTable(rows));
    lines.push("");
  }

  lines.push(...formatInstallCliWorkflow());
  lines.push("");
  lines.push("## Property reference");
  lines.push(...formatInstallPropertyReferenceTable());
  return lines;
}

/** Audit install policy: env overrides beat bunfig; flag drift from hardened defaults. */
export async function auditBunInstallConfig(projectDir: string): Promise<BunInstallConfigAudit> {
  return buildInstallPolicyReport(projectDir);
}
