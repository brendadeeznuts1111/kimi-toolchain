/**
 * Bun install policy — grouped tables: official default | hardened | current.
 *
 * @see https://bun.com/docs/pm/cli/install#configuring-bun-install-with-bunfig-toml
 * @see https://bun.com/docs/pm/cli/install#platform-specific-dependencies
 */

import {
  auditBunImageHealth,
  BUN_IMAGE_DOCS_URL,
  BUN_IMAGE_SOURCE_MODULE,
  BUN_IMAGE_TERMINALS_URL,
  bunImageSupported,
} from "./bun-image.ts";
import {
  BUN_DETECT_BUN_GUIDE_DOC_URL,
  BUN_VERSION_GUIDE_DOC_URL,
  bunVersion,
  detectBunRuntime,
} from "./bun-utils.ts";
import { spawnBun } from "./tool-runner.ts";
import { pathExists } from "./bun-io.ts";
import { join } from "path";
import { TOML } from "bun";

export const BUN_INSTALL_DOC_URL = "https://bun.com/docs/pm/cli/install";
export const BUN_PM_CLI_DOC_URL = "https://bun.com/docs/pm/cli/pm";
export const BUN_PM_CLI_PKG_DOC_URL = `${BUN_PM_CLI_DOC_URL}#pkg`;
export const BUN_PM_UPDATE_DOC_URL = "https://bun.com/docs/pm/cli/update";

export function bunPmCliSectionDocUrl(section: string): string {
  return `${BUN_PM_CLI_DOC_URL}#${section}`;
}

/** Dot/bracket notation paths from `bun pm pkg` docs (#pkg). */
export const BUN_PM_PKG_NOTATION_EXAMPLES = [
  "scripts.build",
  "contributors[0]",
  "workspaces.0",
  "scripts[test:watch]",
] as const;

export const BUN_PM_PKG_OPERATIONS = ["get", "set", "delete", "fix"] as const;

export type BunPmPkgOperation = (typeof BUN_PM_PKG_OPERATIONS)[number];

export interface BunPmCliSectionDef {
  flags?: readonly string[];
  aliases?: readonly string[];
  subcommands?: readonly string[];
  increments?: readonly string[];
  operations?: readonly string[];
  notes?: string;
}

/** Effect-TS documentation URLs (effect.website). */
export const EFFECT_DOCS_URL = "https://effect.website/docs";
export const EFFECT_GEN_DOC_URL = "https://effect.website/docs/effect/gen";
export const EFFECT_TAGGED_ERROR_DOC_URL =
  "https://effect.website/docs/error-management/tagged-errors";
export const EFFECT_LAYER_DOC_URL = "https://effect.website/docs/layers";
export const EFFECT_RUNTIME_DOC_URL = "https://effect.website/docs/runtime";
export const EFFECT_ENSUREING_DOC_URL = "https://effect.website/docs/effect/ensuring";

/** `bun pm` command sections — flags, aliases, and increments per pm.md. */
export const BUN_PM_CLI_SECTIONS = {
  pack: {
    flags: [
      "--dry-run",
      "--destination",
      "--filename",
      "--ignore-scripts",
      "--gzip-level",
      "--quiet",
    ],
    notes: "--filename and --destination cannot be used together",
  },
  bin: {
    flags: ["-g"],
  },
  ls: {
    aliases: ["list"],
    flags: ["--all", "--trusted"],
  },
  whoami: {},
  hash: {
    subcommands: ["hash", "hash-string", "hash-print"],
  },
  cache: {
    subcommands: ["cache", "cache rm"],
  },
  migrate: {},
  untrusted: {},
  trust: {
    flags: ["--all"],
  },
  "default-trusted": {},
  version: {
    increments: [
      "patch",
      "minor",
      "major",
      "premajor",
      "preminor",
      "prepatch",
      "prerelease",
      "from-git",
    ],
    flags: [
      "--no-git-tag-version",
      "--allow-same-version",
      "--message",
      "-m",
      "--preid",
      "--force",
      "-f",
    ],
  },
  pkg: {
    operations: BUN_PM_PKG_OPERATIONS,
  },
} as const satisfies Record<string, BunPmCliSectionDef>;

export type BunPmCliSectionId = keyof typeof BUN_PM_CLI_SECTIONS;

export const BUN_PM_CLI_SECTION_DOC_URLS = Object.fromEntries(
  (Object.keys(BUN_PM_CLI_SECTIONS) as BunPmCliSectionId[]).map((id) => [
    id,
    bunPmCliSectionDocUrl(id),
  ])
) as Record<BunPmCliSectionId, string>;
export const BUN_RELEASE_1_3_13_URL = "https://bun.com/blog/bun-v1.3.13";
export const BUN_RELEASE_1_3_13_SOURCE_MAPS_URL = `${BUN_RELEASE_1_3_13_URL}#source-maps-use-up-to-8x-less-memory`;
export const BUN_RELEASE_1_3_7_URL = "https://bun.com/blog/bun-v1.3.7";
export const BUN_HTML_STATIC_CONSOLE_DOC_URL =
  "https://bun.com/docs/bundler/html-static#echo-console-logs-from-browser-to-terminal";
export const BUN_MARKDOWN_RUN_DOC_URL = "https://bun.com/docs/runtime/markdown.md";
export const BUN_WRAP_ANSI_DOC_URL = "https://bun.com/docs/runtime/utils#bun-wrapansi";
export const BUN_JSON5_DOC_URL = "https://bun.com/docs/runtime/json5#conformance";
export const BUN_JSONL_DOC_URL = "https://bun.com/docs/runtime/jsonl";
export const BUN_WEBVIEW_DOC_URL = "https://bun.com/docs/api/webview";
export const BUN_CRON_IN_PROCESS_DOC_URL = "https://bun.com/docs/api/cron#bun-cron-in-process";
export const BUN_BENCHMARKING_DOC_URL = "https://bun.com/docs/project/benchmarking";
export const BUN_CPU_PROFILING_DOC_URL = `${BUN_BENCHMARKING_DOC_URL}#cpu-profiling`;
export const BUN_CPU_PROF_MD_DOC_URL = `${BUN_BENCHMARKING_DOC_URL}#markdown-output`;
export const BUN_HEAP_PROFILING_DOC_URL = `${BUN_BENCHMARKING_DOC_URL}#heap-profiling`;
export const BUN_HEAP_PROF_MD_DOC_URL = `${BUN_BENCHMARKING_DOC_URL}#markdown-output-2`;
export const BUN_JSC_HEAP_STATS_DOC_URL = `${BUN_BENCHMARKING_DOC_URL}#javascript-heap-stats`;
export const BUN_NATIVE_HEAP_STATS_DOC_URL = `${BUN_BENCHMARKING_DOC_URL}#native-heap-stats`;
export const BUN_MEASURING_TIME_DOC_URL = `${BUN_BENCHMARKING_DOC_URL}#measuring-time`;
export const BUN_BENCH_REPO_URL = "https://github.com/oven-sh/bun/tree/main/bench";
export const BUN_RUNTIME_GLOBALS_DOC_URL = "https://bun.com/docs/runtime/globals";
export const BUN_RUNTIME_BUN_APIS_DOC_URL = "https://bun.com/docs/runtime/bun-apis";
export const BUN_RUNTIME_WEB_APIS_DOC_URL = "https://bun.com/docs/runtime/web-apis";
export const BUN_HEAP_PROF_BLOG_URL = `${BUN_RELEASE_1_3_7_URL}#heap-profiling-with-heap-prof`;
export const BUN_CGROUP_PARALLELISM_DOC_URL = `${BUN_RUNTIME_GLOBALS_DOC_URL}#navigator-hardwareconcurrency`;
export const BUN_RUNTIME_HTTP_DOC_URL = "https://bun.com/docs/runtime/http";
export const BUN_HTTPS_PROXY_KEEPALIVE_DOC_URL = `${BUN_RUNTIME_HTTP_DOC_URL}#proxying`;
export const BUN_TCP_DEFER_ACCEPT_DOC_URL = `${BUN_RUNTIME_HTTP_DOC_URL}#bun-serve`;
export const BUN_WORKSPACES_DOC_URL = "https://bun.com/docs/pm/workspaces";

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
  installFilter: "bun install --filter './examples/<name>'",
  pmList: "bun pm ls",
  pmListAll: "bun pm ls --all",
  pmListTrusted: "bun pm ls --trusted",
  pmPack: "bun pm pack",
  pmPackQuiet: "bun pm pack --quiet",
  pmPackDryRun: "bun pm pack --dry-run",
  pmCache: "bun pm cache",
  pmCacheRm: "bun pm cache rm",
  pmHash: "bun pm hash",
  pmHashString: "bun pm hash-string",
  pmHashPrint: "bun pm hash-print",
  pmBin: "bun pm bin",
  pmBinGlobal: "bun pm bin -g",
  pmMigrate: "bun pm migrate",
  pmUntrusted: "bun pm untrusted",
  pmTrust: "bun pm trust <pkg>",
  pmTrustAll: "bun pm trust --all",
  pmDefaultTrusted: "bun pm default-trusted",
  pmVersion: "bun pm version",
  pmWhoami: "bun pm whoami",
  pmPkgGet: "bun pm pkg get <path>",
  pmPkgSet: "bun pm pkg set <key>=<value>",
  pmPkgDelete: "bun pm pkg delete <path>",
  pmPkgFix: "bun pm pkg fix",
} as const;

export const BUN_PM_CLI_SUBCOMMANDS = [
  "pack",
  "bin",
  "ls",
  "whoami",
  "hash",
  "hash-string",
  "hash-print",
  "cache",
  "cache rm",
  "migrate",
  "untrusted",
  "trust",
  "default-trusted",
  "version",
  "pkg",
] as const;

/** Single SSOT for bun pm CLI capability metadata (interface + runtime builder). */
export function buildBunPmCliCapability() {
  return {
    status: "available" as const,
    sections: BUN_PM_CLI_SECTIONS,
    sectionDocs: BUN_PM_CLI_SECTION_DOC_URLS,
    pkgNotationExamples: BUN_PM_PKG_NOTATION_EXAMPLES,
    pkgOperations: BUN_PM_PKG_OPERATIONS,
    listAlias: "list" as const,
    subcommands: BUN_PM_CLI_SUBCOMMANDS,
    commands: {
      pmList: BUN_INSTALL_CLI.pmList,
      pmListAll: BUN_INSTALL_CLI.pmListAll,
      pmListTrusted: BUN_INSTALL_CLI.pmListTrusted,
      pmPack: BUN_INSTALL_CLI.pmPack,
      pmPackQuiet: BUN_INSTALL_CLI.pmPackQuiet,
      pmPackDryRun: BUN_INSTALL_CLI.pmPackDryRun,
      pmCache: BUN_INSTALL_CLI.pmCache,
      pmCacheRm: BUN_INSTALL_CLI.pmCacheRm,
      pmHash: BUN_INSTALL_CLI.pmHash,
      pmHashString: BUN_INSTALL_CLI.pmHashString,
      pmHashPrint: BUN_INSTALL_CLI.pmHashPrint,
      pmBin: BUN_INSTALL_CLI.pmBin,
      pmBinGlobal: BUN_INSTALL_CLI.pmBinGlobal,
      pmMigrate: BUN_INSTALL_CLI.pmMigrate,
      pmUntrusted: BUN_INSTALL_CLI.pmUntrusted,
      pmTrust: BUN_INSTALL_CLI.pmTrust,
      pmTrustAll: BUN_INSTALL_CLI.pmTrustAll,
      pmDefaultTrusted: BUN_INSTALL_CLI.pmDefaultTrusted,
      pmVersion: BUN_INSTALL_CLI.pmVersion,
      pmWhoami: BUN_INSTALL_CLI.pmWhoami,
      pmPkgGet: BUN_INSTALL_CLI.pmPkgGet,
      pmPkgSet: BUN_INSTALL_CLI.pmPkgSet,
      pmPkgDelete: BUN_INSTALL_CLI.pmPkgDelete,
      pmPkgFix: BUN_INSTALL_CLI.pmPkgFix,
    },
    docsUrl: BUN_PM_CLI_DOC_URL,
    pkgDocsUrl: BUN_PM_CLI_PKG_DOC_URL,
    description: "Package manager utilities — pack, list, hash, cache, trust, version, pkg",
    notes:
      "Mirror of bun.com/docs/pm/cli/pm — use bun pm ls --all for workspace lockfile trees and bun pm pkg for package.json mutations.",
  };
}

export type BunPmCliCapability = ReturnType<typeof buildBunPmCliCapability>;

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
    docsUrl: `${BUN_PM_UPDATE_DOC_URL}#cli-usage`,
  },
  {
    property: "cli.updateInteractive",
    type: "command",
    default: BUN_INSTALL_CLI.updateInteractive,
    required: false,
    description: "Interactive outdated-package picker",
    versionAdded: "1.1",
    lastModified: BUN_INSTALL_POLICY_LAST_MODIFIED,
    docsUrl: `${BUN_PM_UPDATE_DOC_URL}#interactive`,
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
    docsUrl: BUN_WORKSPACES_DOC_URL,
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
  scopes?: Record<string, string | { url?: string }>;
}

export interface FrozenLockfileScopeRegistryFallback {
  packageName: string;
  scope: string;
  lockfileRegistryUrl: "";
  bunfigRegistryUrl: string;
  registrySource: string;
}

interface PackageJsonInstallMeta {
  name?: string;
  packageManager?: string;
  engines?: { bun?: string };
  trustedDependencies?: string[];
  workspaces?: string[];
}

/** Transparent runtime speedups — doctor human output only; not inventory-gated. */
export interface BunInstallInternalOptimizations {
  readonly informational: true;
  /** Semver from live `Bun.version` (refreshed each report build). */
  bunVersion: string;
  /** Git revision from live `Bun.revision`. */
  bunRevision: string;
  /** Whether the report was built under a detected Bun runtime. */
  runtimeDetected: boolean;
  notes: readonly string[];
  docs: {
    versionGuide: typeof BUN_VERSION_GUIDE_DOC_URL;
    detectBunGuide: typeof BUN_DETECT_BUN_GUIDE_DOC_URL;
    updateCli: typeof BUN_PM_UPDATE_DOC_URL;
  };
}

export interface BunInstallConfigAudit {
  schemaVersion: 1;
  docsUrl: string;
  versions: BunInstallVersionInfo;
  runtimeCapabilities: BunInstallRuntimeCapabilities;
  internalOptimizations: BunInstallInternalOptimizations;
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
  pmPackLifecycleManifest: {
    status: "rereads-package-json";
    command: "bun pm pack";
    lifecycleScripts: readonly ["prepack", "prepare", "prepublishOnly"];
    packageJsonBehavior: "re-read after lifecycle scripts";
    notes: string;
  };
  inspectorProfiler: {
    status: "available";
    module: "node:inspector/promises";
    methods: readonly [
      "Profiler.enable",
      "Profiler.disable",
      "Profiler.start",
      "Profiler.stop",
      "Profiler.setSamplingInterval",
    ];
    profileFormat: "Chrome DevTools Protocol";
    notes: string;
  };
  ffiCompilerPaths: {
    status: "env-aware";
    module: "bun:ffi";
    env: {
      C_INCLUDE_PATH: string | null;
      LIBRARY_PATH: string | null;
    };
    appliesTo: "Bun built-in C compiler";
    platformUse: "NixOS and non-FHS systems";
    notes: string;
  };
  packageManagerFixes: {
    status: "tracked";
    fixes: readonly {
      id:
        | "update-interactive-latest-toggle"
        | "install-yarn-workspace-lockfile"
        | "frozen-lockfile-scope-registry"
        | "file-path-stale-lockfile-error"
        | "add-network-metadata-panic";
      command: string;
      surface: string;
      regression: string;
      expected: string;
      diagnostic?: "findFrozenLockfileScopeRegistryFallbacks";
      lockfileRegistryUrl?: string;
      registrySource?: string;
      exampleScope?: string;
    }[];
  };
  timerIdleStart: {
    status: "node-compatible";
    property: "_idleStart";
    objects: readonly ["setTimeout", "setInterval"];
    rescheduledBy: readonly ["Timeout.refresh()"];
    timestamp: "monotonic milliseconds";
    compatibility: "Next.js 16 Cache Components";
    notes: string;
  };
  parallelConsole: {
    status: "buffered";
    appliesTo: "bun test --parallel";
    flush: "per-file atomic";
    streams: readonly ["console.log", "console.error"];
    notes: string;
  };
  htmlStaticConsoleEcho: {
    status: "available";
    command: "bun ./index.html --console";
    appliesTo: "Bun HTML static dev server";
    flag: "--console";
    streams: readonly ["console.log", "console.error"];
    transport: "HMR WebSocket";
    docsUrl: typeof BUN_HTML_STATIC_CONSOLE_DOC_URL;
    agentUse: "browser logs visible in the terminal that started the dev server";
  };
  markdownTerminalRender: {
    status: "available";
    command: string;
    description: string;
    docsUrl: typeof BUN_MARKDOWN_RUN_DOC_URL;
  };
  wrapAnsi: {
    status: "available";
    command: string;
    description: string;
    docsUrl: typeof BUN_WRAP_ANSI_DOC_URL;
  };
  json5Native: {
    status: "available";
    command: string;
    description: string;
    docsUrl: typeof BUN_JSON5_DOC_URL;
  };
  jsonlStreaming: {
    status: "available";
    command: string;
    description: string;
    docsUrl: typeof BUN_JSONL_DOC_URL;
  };
  webView: {
    status: "active";
    command: string;
    description: string;
    docsUrl: typeof BUN_WEBVIEW_DOC_URL;
    streams: readonly ["stdout"];
    transport: "ws://localhost:9222/devtools/browser";
    hmr: false;
  };
  inProcessCron: {
    status: "active";
    command: string;
    description: string;
    docsUrl: typeof BUN_CRON_IN_PROCESS_DOC_URL;
    streams: readonly ["stdout"];
    hmr: true;
  };
  cpuProfMarkdown: {
    status: "active";
    command: string;
    combinedCommand: "bun --cpu-prof --cpu-prof-md script.js";
    description: string;
    docsUrl: typeof BUN_CPU_PROF_MD_DOC_URL;
    markdownDocsUrl: typeof BUN_CPU_PROF_MD_DOC_URL;
    profilingDocsUrl: typeof BUN_CPU_PROFILING_DOC_URL;
    flags: readonly ["--cpu-prof-md", "--cpu-prof", "--cpu-prof-name", "--cpu-prof-dir"];
    outputFormats: readonly ["cpuprofile", "markdown"];
    bunOptionsEnv: 'BUN_OPTIONS="--cpu-prof-md"';
    streams: readonly ["stdout"];
    hmr: false;
  };
  heapProf: {
    status: "active";
    command: string;
    markdownCommand: string;
    description: string;
    docsUrl: typeof BUN_HEAP_PROF_MD_DOC_URL;
    markdownDocsUrl: typeof BUN_HEAP_PROF_MD_DOC_URL;
    profilingDocsUrl: typeof BUN_HEAP_PROFILING_DOC_URL;
    releaseUrl: typeof BUN_HEAP_PROF_BLOG_URL;
    flags: readonly ["--heap-prof", "--heap-prof-md", "--heap-prof-name", "--heap-prof-dir"];
    outputFormats: readonly ["heapsnapshot", "markdown"];
    notes: string;
    streams: readonly ["stdout"];
    hmr: false;
  };
  jscHeapStats: {
    status: "available";
    command: string;
    module: "bun:jsc";
    methods: readonly ["heapStats"];
    metrics: readonly [
      "heapSize",
      "heapCapacity",
      "extraMemorySize",
      "objectCount",
      "protectedObjectCount",
      "objectTypeCounts",
      "protectedObjectTypeCounts",
    ];
    gc: "Bun.gc(true) synchronous; Bun.gc(false) asynchronous";
    snapshot: "generateHeapSnapshot() from bun — import heap.json in Safari/WebKit GTK";
    nativeHeapEnv: "MIMALLOC_SHOW_STATS=1";
    nativeHeapCommand: "MIMALLOC_SHOW_STATS=1 bun script.js";
    docsUrl: typeof BUN_JSC_HEAP_STATS_DOC_URL;
    nativeHeapDocsUrl: typeof BUN_NATIVE_HEAP_STATS_DOC_URL;
    notes: string;
  };
  measuringTime: {
    status: "available";
    command: string;
    description: string;
    docsUrl: typeof BUN_MEASURING_TIME_DOC_URL;
    apis: readonly ["performance.now()", "Bun.nanoseconds()", "performance.timeOrigin"];
    notes: string;
  };
  publicBenchmarks: {
    status: "available";
    repoUrl: typeof BUN_BENCH_REPO_URL;
    path: "bench/";
    description: string;
    docsUrl: typeof BUN_BENCHMARKING_DOC_URL;
  };
  runtimeApiDocs: {
    status: "available";
    description: string;
    globalsUrl: typeof BUN_RUNTIME_GLOBALS_DOC_URL;
    bunApisUrl: typeof BUN_RUNTIME_BUN_APIS_DOC_URL;
    webApisUrl: typeof BUN_RUNTIME_WEB_APIS_DOC_URL;
  };
  bunImage: {
    status: "available" | "unavailable";
    command: string;
    description: string;
    docsUrl: typeof BUN_IMAGE_DOCS_URL;
    terminalsUrl: typeof BUN_IMAGE_TERMINALS_URL;
    dashboardPaths: readonly ["/api/image", "/api/thumbnail", "/api/bun-mark"];
    sourceModule: typeof BUN_IMAGE_SOURCE_MODULE;
    notes: string;
  };
  cgroupAwareParallelism: {
    status: "active";
    command: string;
    description: string;
    docsUrl: typeof BUN_CGROUP_PARALLELISM_DOC_URL;
    streams: readonly ["stdout"];
    hmr: false;
  };
  httpsProxyKeepAlive: {
    status: "active";
    command: string;
    description: string;
    docsUrl: typeof BUN_HTTPS_PROXY_KEEPALIVE_DOC_URL;
    streams: readonly ["stdout"];
    hmr: false;
  };
  tcpDeferAccept: {
    status: "active";
    command: string;
    description: string;
    docsUrl: typeof BUN_TCP_DEFER_ACCEPT_DOC_URL;
    streams: readonly ["stdout"];
    hmr: false;
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
  bunPmCli: BunPmCliCapability;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeNpmScope(scope: string): string {
  return scope.startsWith("@") ? scope : `@${scope}`;
}

function scopeRegistryUrl(value: unknown): string | null {
  if (typeof value === "string" && value.trim() !== "") return value;
  if (isRecord(value) && typeof value.url === "string" && value.url.trim() !== "") {
    return value.url;
  }
  return null;
}

export function extractBunfigScopeRegistries(bunfigText: string): Record<string, string> {
  try {
    const parsed = TOML.parse(bunfigText) as { install?: BunfigInstallSection };
    const scopes = parsed.install?.scopes ?? {};
    const registries: Record<string, string> = {};
    for (const [scope, value] of Object.entries(scopes)) {
      const url = scopeRegistryUrl(value);
      if (url) registries[normalizeNpmScope(scope)] = url;
    }
    return registries;
  } catch {
    return {};
  }
}

export function findScopedRegistryFallbacksInBunLock(
  bunLockText: string,
  scopeRegistries: Record<string, string>
): FrozenLockfileScopeRegistryFallback[] {
  const fallbacks: FrozenLockfileScopeRegistryFallback[] = [];
  const packageRows = /^\s*"(@[^"/]+\/[^"]+)":\s*\[\s*"[^"]+"\s*,\s*"([^"]*)"/gm;

  for (const match of bunLockText.matchAll(packageRows)) {
    const [, packageName, registryUrl] = match;
    if (!packageName || registryUrl !== "") continue;

    const scope = packageName.slice(0, packageName.indexOf("/"));
    const bunfigRegistryUrl = scopeRegistries[scope];
    if (!bunfigRegistryUrl) continue;

    fallbacks.push({
      packageName,
      scope,
      lockfileRegistryUrl: "",
      bunfigRegistryUrl,
      registrySource: `bunfig.toml [install.scopes] "${scope}"`,
    });
  }

  return fallbacks;
}

export function findFrozenLockfileScopeRegistryFallbacks(
  bunLockText: string,
  bunfigText: string
): FrozenLockfileScopeRegistryFallback[] {
  return findScopedRegistryFallbacksInBunLock(
    bunLockText,
    extractBunfigScopeRegistries(bunfigText)
  );
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

/** Release-notes style perf wins without separate capability inventory keys. */
export const BUN_INTERNAL_OPTIMIZATION_NOTES = [
  "URLPattern matching ~2.9x faster (internal; no new API surface)",
  "stripANSI SIMD path for large decorated strings (internal)",
  "bun build parallel compile threading fix (internal)",
  "Glob.scan directory traversal speedup (internal)",
] as const;

export function buildInternalOptimizations(): BunInstallInternalOptimizations {
  const runtime = detectBunRuntime();
  return {
    informational: true,
    bunVersion: runtime.version,
    bunRevision: runtime.revision,
    runtimeDetected: runtime.detected,
    notes: BUN_INTERNAL_OPTIMIZATION_NOTES,
    docs: {
      versionGuide: BUN_VERSION_GUIDE_DOC_URL,
      detectBunGuide: BUN_DETECT_BUN_GUIDE_DOC_URL,
      updateCli: BUN_PM_UPDATE_DOC_URL,
    },
  };
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
    pmPackLifecycleManifest: {
      status: "rereads-package-json",
      command: "bun pm pack",
      lifecycleScripts: ["prepack", "prepare", "prepublishOnly"],
      packageJsonBehavior: "re-read after lifecycle scripts",
      notes:
        "Bun re-reads package.json after pack lifecycle scripts, so clean-package style mutations are reflected in the produced tarball.",
    },
    inspectorProfiler: {
      status: "available",
      module: "node:inspector/promises",
      methods: [
        "Profiler.enable",
        "Profiler.disable",
        "Profiler.start",
        "Profiler.stop",
        "Profiler.setSamplingInterval",
      ],
      profileFormat: "Chrome DevTools Protocol",
      notes:
        "Bun implements the node:inspector Profiler API for CPU profiling and returns Chrome DevTools Protocol profile payloads.",
    },
    ffiCompilerPaths: {
      status: "env-aware",
      module: "bun:ffi",
      env: {
        C_INCLUDE_PATH: Bun.env.C_INCLUDE_PATH ?? null,
        LIBRARY_PATH: Bun.env.LIBRARY_PATH ?? null,
      },
      appliesTo: "Bun built-in C compiler",
      platformUse: "NixOS and non-FHS systems",
      notes:
        "Bun's built-in C compiler respects standard C_INCLUDE_PATH and LIBRARY_PATH values when resolving headers and libraries for bun:ffi.",
    },
    packageManagerFixes: {
      status: "tracked",
      fixes: [
        {
          id: "update-interactive-latest-toggle",
          command: BUN_INSTALL_CLI.updateInteractive,
          surface: "interactive update selection",
          regression:
            "pressing l to toggle Target/Latest made the underline indicator disappear and excluded packages on confirm",
          expected: "toggling Target/Latest keeps package selection intact",
        },
        {
          id: "install-yarn-workspace-lockfile",
          command: "bun install --yarn",
          surface: "Yarn v1 lockfile generation",
          regression: "workspace:* dependencies in monorepos produced invalid yarn.lock entries",
          expected: "workspace:* dependencies serialize to valid yarn.lock content",
        },
        {
          id: "frozen-lockfile-scope-registry",
          command: BUN_INSTALL_CLI.frozenInstall,
          surface: "scope-specific bunfig registries",
          regression:
            "empty registry URLs in the lockfile fell back to the default npm registry for scoped packages",
          expected: "frozen installs honor scope-specific registries from bunfig.toml",
          diagnostic: "findFrozenLockfileScopeRegistryFallbacks",
          lockfileRegistryUrl: '""',
          registrySource: 'bunfig.toml [install.scopes] "@orgname"',
          exampleScope: "@orgname",
        },
        {
          id: "file-path-stale-lockfile-error",
          command: BUN_INSTALL_CLI.install,
          surface: "file: dependency resolution",
          regression:
            "stale lockfile file: path failures omitted the dependency name and reported a misleading package.json error",
          expected: "file: path resolution errors include the affected dependency name",
        },
        {
          id: "add-network-metadata-panic",
          command: BUN_INSTALL_CLI.add,
          surface: "network failure handling",
          regression:
            "HTTP failures before response headers could panic with Expected metadata to be set",
          expected: "network failures return a normal package-manager error instead of panicking",
        },
      ],
    },
    timerIdleStart: {
      status: "node-compatible",
      property: "_idleStart",
      objects: ["setTimeout", "setInterval"],
      rescheduledBy: ["Timeout.refresh()"],
      timestamp: "monotonic milliseconds",
      compatibility: "Next.js 16 Cache Components",
      notes:
        "Timeout objects returned by setTimeout and setInterval expose Node-compatible _idleStart timestamps; Timeout.refresh updates the timestamp when rescheduled.",
    },
    parallelConsole: {
      status: "buffered",
      appliesTo: "bun test --parallel",
      flush: "per-file atomic",
      streams: ["console.log", "console.error"],
      notes:
        "Bun buffers console output per test file under --parallel and flushes each file atomically so concurrent files do not interleave.",
    },
    htmlStaticConsoleEcho: {
      status: "available",
      command: "bun ./index.html --console",
      appliesTo: "Bun HTML static dev server",
      flag: "--console",
      streams: ["console.log", "console.error"],
      transport: "HMR WebSocket",
      docsUrl: BUN_HTML_STATIC_CONSOLE_DOC_URL,
      agentUse: "browser logs visible in the terminal that started the dev server",
    },
    markdownTerminalRender: {
      status: "available",
      command: "bun ./README.md",
      description: "Zero-VM-overhead Markdown rendering in the terminal",
      docsUrl: BUN_MARKDOWN_RUN_DOC_URL,
    },
    wrapAnsi: {
      status: "available",
      command:
        "bun -e 'console.log(Bun.wrapAnsi(\"\\x1b[31mThis is a long red text that needs wrapping\\x1b[0m\", 20))'",
      description:
        "Native wrap-ansi — preserves SGR colors, OSC 8 hyperlinks, Unicode widths; 33–88x faster than npm",
      docsUrl: BUN_WRAP_ANSI_DOC_URL,
    },
    json5Native: {
      status: "available",
      command: "bun -e 'console.log(Bun.JSON5.parse(\"// config\\n{ key: 1 }\"))'",
      description:
        "Bun.JSON5.parse/stringify plus native .json5 imports (comments, trailing commas, unquoted keys)",
      docsUrl: BUN_JSON5_DOC_URL,
    },
    jsonlStreaming: {
      status: "available",
      command:
        'bun -e \'const res = Bun.JSONL.parseChunk("{\\"a\\":1}\\n{\\"b\\":2}\\n{\\"c\\""); console.log(res.values, res.read, res.done)\'',
      description:
        "Bun.JSONL.parse for complete inputs; parseChunk for incremental streams (values, read, done)",
      docsUrl: BUN_JSONL_DOC_URL,
    },
    webView: {
      status: "active",
      command:
        "bun -e 'await using view = new Bun.WebView({ width: 800, height: 600 }); await view.navigate(\"https://bun.sh\"); console.log(await view.title);'",
      description:
        "Headless browser automation (WebKit/Chrome) — Playwright-style actionability, OS-level events, CDP WebSocket transport",
      docsUrl: BUN_WEBVIEW_DOC_URL,
      streams: ["stdout"],
      transport: "ws://localhost:9222/devtools/browser",
      hmr: false,
    },
    inProcessCron: {
      status: "active",
      command:
        'bun -e \'const job = Bun.cron("* * * * *", () => console.log("tick")); setTimeout(() => job.stop(), 1000);\'',
      description:
        "In-process UTC cron scheduler — no overlap, --hot safe, ref/unref; shares application state",
      docsUrl: BUN_CRON_IN_PROCESS_DOC_URL,
      streams: ["stdout"],
      hmr: true,
    },
    cpuProfMarkdown: {
      status: "active",
      command: "bun --cpu-prof-md -e 'process.exit(0)'",
      combinedCommand: "bun --cpu-prof --cpu-prof-md script.js",
      description: "Markdown CPU profile output (--cpu-prof-md) for LLM-friendly analysis",
      docsUrl: BUN_CPU_PROF_MD_DOC_URL,
      markdownDocsUrl: BUN_CPU_PROF_MD_DOC_URL,
      profilingDocsUrl: BUN_CPU_PROFILING_DOC_URL,
      flags: ["--cpu-prof-md", "--cpu-prof", "--cpu-prof-name", "--cpu-prof-dir"],
      outputFormats: ["cpuprofile", "markdown"],
      bunOptionsEnv: 'BUN_OPTIONS="--cpu-prof-md"',
      streams: ["stdout"],
      hmr: false,
    },
    heapProf: {
      status: "active",
      command: "bun --heap-prof-md -e 'process.exit(0)'",
      markdownCommand: "bun --heap-prof-md script.js",
      description: "Heap profiling with markdown output (--heap-prof-md) for memory leak diagnosis",
      docsUrl: BUN_HEAP_PROF_MD_DOC_URL,
      markdownDocsUrl: BUN_HEAP_PROF_MD_DOC_URL,
      profilingDocsUrl: BUN_HEAP_PROFILING_DOC_URL,
      releaseUrl: BUN_HEAP_PROF_BLOG_URL,
      flags: ["--heap-prof", "--heap-prof-md", "--heap-prof-name", "--heap-prof-dir"],
      outputFormats: ["heapsnapshot", "markdown"],
      notes:
        "When both --heap-prof and --heap-prof-md are set, markdown output is used (not both formats).",
      streams: ["stdout"],
      hmr: false,
    },
    jscHeapStats: {
      status: "available",
      command: "bun -e 'import { heapStats } from \"bun:jsc\"; console.log(heapStats());'",
      module: "bun:jsc",
      methods: ["heapStats"],
      metrics: [
        "heapSize",
        "heapCapacity",
        "extraMemorySize",
        "objectCount",
        "protectedObjectCount",
        "objectTypeCounts",
        "protectedObjectTypeCounts",
      ],
      gc: "Bun.gc(true) synchronous; Bun.gc(false) asynchronous",
      snapshot: "generateHeapSnapshot() from bun — import heap.json in Safari/WebKit GTK",
      nativeHeapEnv: "MIMALLOC_SHOW_STATS=1",
      nativeHeapCommand: "MIMALLOC_SHOW_STATS=1 bun script.js",
      docsUrl: BUN_JSC_HEAP_STATS_DOC_URL,
      nativeHeapDocsUrl: BUN_NATIVE_HEAP_STATS_DOC_URL,
      notes:
        "JavaScript is GC-collected; delayed frees are normal. Bun has separate JS and native (mimalloc) heaps.",
    },
    measuringTime: {
      status: "available",
      command:
        "bun -e 'const t0 = Bun.nanoseconds(); const ms = performance.now(); console.log(Bun.nanoseconds() - t0, ms, performance.timeOrigin);'",
      description:
        "High-precision timing — performance.now() (web standard) and Bun.nanoseconds() since app start",
      docsUrl: BUN_MEASURING_TIME_DOC_URL,
      apis: ["performance.now()", "Bun.nanoseconds()", "performance.timeOrigin"],
      notes:
        "Use performance.timeOrigin with Bun.nanoseconds() to convert elapsed time to a Unix timestamp.",
    },
    publicBenchmarks: {
      status: "available",
      repoUrl: BUN_BENCH_REPO_URL,
      path: "bench/",
      description:
        "Source for all of Bun's public benchmarks — hot paths are profiled and benchmarked in the oven-sh/bun repo",
      docsUrl: BUN_BENCHMARKING_DOC_URL,
    },
    runtimeApiDocs: {
      status: "available",
      description:
        "Canonical runtime API reference — globals, Bun-native APIs (Bun.*), and Web-standard APIs",
      globalsUrl: BUN_RUNTIME_GLOBALS_DOC_URL,
      bunApisUrl: BUN_RUNTIME_BUN_APIS_DOC_URL,
      webApisUrl: BUN_RUNTIME_WEB_APIS_DOC_URL,
    },
    bunImage: {
      status: bunImageSupported() ? "available" : "unavailable",
      command:
        "bun -e 'const png = Uint8Array.from(atob(\"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==\"), c => c.charCodeAt(0)); console.log(await new Bun.Image(png).metadata())'",
      description:
        "Native image pipeline — metadata(), resize/encode (WebP/AVIF/JPEG/PNG), placeholders, platform backends",
      docsUrl: BUN_IMAGE_DOCS_URL,
      terminalsUrl: BUN_IMAGE_TERMINALS_URL,
      dashboardPaths: ["/api/image", "/api/thumbnail", "/api/bun-mark"],
      sourceModule: BUN_IMAGE_SOURCE_MODULE,
      notes:
        "Herdr thumbnails await Bun.Image .blob() terminals; examples dashboard card-effect-image mirrors processor.ts",
    },
    cgroupAwareParallelism: {
      status: "active",
      command: "bun -e 'console.log(navigator.hardwareConcurrency)'",
      description: "Cgroup-aware availableParallelism / hardwareConcurrency on Linux",
      docsUrl: BUN_CGROUP_PARALLELISM_DOC_URL,
      streams: ["stdout"],
      hmr: false,
    },
    httpsProxyKeepAlive: {
      status: "active",
      command:
        'bun -e \'fetch("https://example.com", {proxy: "http://user:pass@proxy.example.com:8080"}).then(()=>process.exit(0)).catch(()=>process.exit(0))\'',
      description:
        "HTTPS proxy CONNECT tunnel reuse (Keep-Alive) for fetch — reduces connection overhead",
      docsUrl: BUN_HTTPS_PROXY_KEEPALIVE_DOC_URL,
      streams: ["stdout"],
      hmr: false,
    },
    tcpDeferAccept: {
      status: "active",
      command:
        'bun -e \'const server = Bun.serve({fetch:()=>new Response("ok"),port:0});console.log("server started");setTimeout(()=>server.stop(),100)\'',
      description:
        "TCP_DEFER_ACCEPT for Bun.serve() on Linux — collapses accept+read into one epoll wakeup",
      docsUrl: BUN_TCP_DEFER_ACCEPT_DOC_URL,
      streams: ["stdout"],
      hmr: false,
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
    bunPmCli: buildBunPmCliCapability(),
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
  const internalOptimizations = buildInternalOptimizations();
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
    internalOptimizations,
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
    `  pmPackLifecycleManifest: ${report.runtimeCapabilities.pmPackLifecycleManifest.status} (${report.runtimeCapabilities.pmPackLifecycleManifest.command})`,
    `  inspectorProfiler: ${report.runtimeCapabilities.inspectorProfiler.status} (${report.runtimeCapabilities.inspectorProfiler.profileFormat})`,
    `  ffiCompilerPaths: ${report.runtimeCapabilities.ffiCompilerPaths.status} (${report.runtimeCapabilities.ffiCompilerPaths.module})`,
    `  packageManagerFixes: ${report.runtimeCapabilities.packageManagerFixes.status} (${report.runtimeCapabilities.packageManagerFixes.fixes.length} fixes)`,
    `  timerIdleStart: ${report.runtimeCapabilities.timerIdleStart.status} (${report.runtimeCapabilities.timerIdleStart.property})`,
    `  parallelConsole: ${report.runtimeCapabilities.parallelConsole.status} (${report.runtimeCapabilities.parallelConsole.flush})`,
    `  htmlStaticConsoleEcho: ${report.runtimeCapabilities.htmlStaticConsoleEcho.status} (${report.runtimeCapabilities.htmlStaticConsoleEcho.flag})`,
    `  markdownTerminalRender: ${report.runtimeCapabilities.markdownTerminalRender.status}`,
    `  wrapAnsi: ${report.runtimeCapabilities.wrapAnsi.status}`,
    `  json5Native: ${report.runtimeCapabilities.json5Native.status}`,
    `  jsonlStreaming: ${report.runtimeCapabilities.jsonlStreaming.status}`,
    `  webView: ${report.runtimeCapabilities.webView.status}`,
    `  inProcessCron: ${report.runtimeCapabilities.inProcessCron.status}`,
    `  cpuProfMarkdown: ${report.runtimeCapabilities.cpuProfMarkdown.status} (--cpu-prof-md)`,
    `  heapProf: ${report.runtimeCapabilities.heapProf.status} (--heap-prof / --heap-prof-md)`,
    `  jscHeapStats: ${report.runtimeCapabilities.jscHeapStats.status} (${report.runtimeCapabilities.jscHeapStats.module})`,
    `  measuringTime: ${report.runtimeCapabilities.measuringTime.status}`,
    `  publicBenchmarks: ${report.runtimeCapabilities.publicBenchmarks.status} (${report.runtimeCapabilities.publicBenchmarks.path})`,
    `  runtimeApiDocs: ${report.runtimeCapabilities.runtimeApiDocs.status} (globals · bun-apis · web-apis)`,
    `  bunImage: ${report.runtimeCapabilities.bunImage.status} (${report.runtimeCapabilities.bunImage.dashboardPaths.join(", ")})`,
    `  cgroupAwareParallelism: ${report.runtimeCapabilities.cgroupAwareParallelism.status}`,
    `  httpsProxyKeepAlive: ${report.runtimeCapabilities.httpsProxyKeepAlive.status}`,
    `  tcpDeferAccept: ${report.runtimeCapabilities.tcpDeferAccept.status}`,
    `  platformTargeting: ${report.runtimeCapabilities.platformTargeting.crossInstall.status} (${report.runtimeCapabilities.platformTargeting.cpu}/${report.runtimeCapabilities.platformTargeting.os})`,
    "Internal optimizations (informational — not inventory-gated):",
    `  bun ${report.internalOptimizations.bunVersion} (${report.internalOptimizations.bunRevision}) runtime=${report.internalOptimizations.runtimeDetected ? "detected" : "absent"}`,
    ...report.internalOptimizations.notes.map((note) => `  - ${note}`),
    `  docs: ${report.internalOptimizations.docs.versionGuide} · ${report.internalOptimizations.docs.updateCli}`,
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

/** Inventory keys agents expect in `runtimeCapabilities` (toolchain SSOT). */
export const RUNTIME_CAPABILITY_INVENTORY_KEYS = [
  "runtimeApiDocs",
  "measuringTime",
  "publicBenchmarks",
  "cpuProfMarkdown",
  "heapProf",
  "jscHeapStats",
  "markdownTerminalRender",
  "wrapAnsi",
  "json5Native",
  "jsonlStreaming",
  "webView",
  "inProcessCron",
  "bunImage",
  "cgroupAwareParallelism",
  "httpsProxyKeepAlive",
  "tcpDeferAccept",
  "bunPmCli",
] as const;

export const BUN_INSTALL_INSPECT_COMMAND = "bun run bun-install:status --json";
export const BUN_INSTALL_SOURCE_MODULE = "src/lib/bun-install-config.ts";

export type BunInstallProbeSuffix = "runtime-api-docs" | "capabilities" | "bun-image" | "bun-pm";
export type BunInstallProbeId = `bun-install:${BunInstallProbeSuffix}`;

const BUN_INSTALL_PROBE_SUFFIXES: readonly BunInstallProbeSuffix[] = [
  "runtime-api-docs",
  "capabilities",
  "bun-image",
  "bun-pm",
];

export interface RuntimeCapabilitiesHealthCheck {
  name: string;
  status: "ok" | "error";
  message: string;
  fixable: boolean;
}

export interface RuntimeCapabilitiesHealthReport {
  applicable: boolean;
  aligned: boolean;
  checks: RuntimeCapabilitiesHealthCheck[];
  fixPlan: string[];
  runtimeApiDocs: BunInstallRuntimeCapabilities["runtimeApiDocs"] | null;
  capabilityCount: number;
  inspectCommand: typeof BUN_INSTALL_INSPECT_COMMAND;
  sourceModule: typeof BUN_INSTALL_SOURCE_MODULE;
}

export function isBunInstallProbeId(id: string): id is BunInstallProbeId {
  return BUN_INSTALL_PROBE_SUFFIXES.some((suffix) => id === `bun-install:${suffix}`);
}

function isBunComDocsUrl(url: string, pathname: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "bun.com" && parsed.pathname === pathname;
  } catch {
    return false;
  }
}

function isBunPmCliDocsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "bun.com" && parsed.pathname === "/docs/pm/cli/pm";
  } catch {
    return false;
  }
}

function parsePmPkgGetName(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === "string") return parsed;
  } catch {
    // fall through — Bun may emit a bare package name
  }
  return trimmed.replace(/^["']|["']$/g, "");
}

export interface BunPmCliHealthReport {
  applicable: boolean;
  aligned: boolean;
  checks: RuntimeCapabilitiesHealthCheck[];
  fixPlan: string[];
  bunPmCli: BunInstallRuntimeCapabilities["bunPmCli"] | null;
  inspectCommand: typeof BUN_INSTALL_INSPECT_COMMAND;
  sourceModule: typeof BUN_INSTALL_SOURCE_MODULE;
  docsUrl: typeof BUN_PM_CLI_DOC_URL;
}

/** Probe `bun pm hash`, `bun pm bin`, and `bun pm pkg get name` (toolchain only). */
export async function auditBunPmCliHealth(projectRoot: string): Promise<BunPmCliHealthReport> {
  const base = {
    inspectCommand: BUN_INSTALL_INSPECT_COMMAND,
    sourceModule: BUN_INSTALL_SOURCE_MODULE,
    docsUrl: BUN_PM_CLI_DOC_URL,
  } as const;

  const { packageMeta } = await readProjectInstallMeta(projectRoot);
  if (packageMeta?.name !== "kimi-toolchain") {
    return {
      applicable: false,
      aligned: true,
      checks: [],
      fixPlan: [],
      bunPmCli: null,
      ...base,
    };
  }

  const report = await buildInstallPolicyReport(projectRoot);
  const bunPmCli = report.runtimeCapabilities.bunPmCli;
  const checks: RuntimeCapabilitiesHealthCheck[] = [];
  const fixPlan: string[] = [];

  if (isBunPmCliDocsUrl(bunPmCli.docsUrl)) {
    checks.push({
      name: "bun-pm:docs-url",
      status: "ok",
      message: bunPmCli.docsUrl,
      fixable: false,
    });
  } else {
    checks.push({
      name: "bun-pm:docs-url",
      status: "error",
      message: `bunPmCli docsUrl invalid: ${bunPmCli.docsUrl}`,
      fixable: true,
    });
    fixPlan.push(`fix bunPmCli.docsUrl in ${BUN_INSTALL_SOURCE_MODULE}`);
  }

  if (bunPmCli.status === "available") {
    checks.push({
      name: "bun-pm:capability",
      status: "ok",
      message: `bunPmCli ${bunPmCli.status}`,
      fixable: false,
    });
  } else {
    checks.push({
      name: "bun-pm:capability",
      status: "error",
      message: `bunPmCli status=${bunPmCli.status}`,
      fixable: true,
    });
    fixPlan.push(`restore bunPmCli status in buildRuntimeCapabilities()`);
  }

  const hash = await spawnBun(["pm", "hash"], { cwd: projectRoot });
  const bin = await spawnBun(["pm", "bin"], { cwd: projectRoot });
  const pkg = await spawnBun(["pm", "pkg", "get", "name"], { cwd: projectRoot });

  const hashOk = !hash.isError && hash.exitCode === 0 && hash.stdout.trim().length > 0;
  const binOk = !bin.isError && bin.exitCode === 0 && bin.stdout.trim().includes("node_modules");
  const pkgName = parsePmPkgGetName(pkg.stdout);
  const pkgOk = !pkg.isError && pkg.exitCode === 0 && pkgName === "kimi-toolchain";

  const probesOk = hashOk && binOk && pkgOk;
  checks.push({
    name: "bun-pm:hash-bin-pkg",
    status: probesOk ? "ok" : "error",
    message: probesOk
      ? "bun pm hash, bin, and pkg get name probes passed"
      : `probe failures: hash=${hashOk} bin=${binOk} pkg=${pkgOk} (name=${pkgName || "empty"})`,
    fixable: !probesOk,
  });
  if (!probesOk) {
    fixPlan.push(
      "verify bun pm hash/bin/pkg get name from repo root — lockfile and package.json must be intact"
    );
  }

  const aligned = checks.every((check) => check.status === "ok");
  return {
    applicable: true,
    aligned,
    checks,
    fixPlan: [...new Set(fixPlan)],
    bunPmCli,
    ...base,
  };
}

/** Validate runtime capability inventory and `runtimeApiDocs` URLs (toolchain only). */
export async function auditRuntimeCapabilitiesHealth(
  projectRoot: string
): Promise<RuntimeCapabilitiesHealthReport> {
  const { packageMeta } = await readProjectInstallMeta(projectRoot);
  const base = {
    inspectCommand: BUN_INSTALL_INSPECT_COMMAND,
    sourceModule: BUN_INSTALL_SOURCE_MODULE,
  } as const;

  if (packageMeta?.name !== "kimi-toolchain") {
    return {
      applicable: false,
      aligned: true,
      checks: [],
      fixPlan: [],
      runtimeApiDocs: null,
      capabilityCount: 0,
      ...base,
    };
  }

  const report = await buildInstallPolicyReport(projectRoot);
  const caps = report.runtimeCapabilities;
  const checks: RuntimeCapabilitiesHealthCheck[] = [];
  const fixPlan: string[] = [];

  const apiDocFields: ReadonlyArray<{
    field: keyof BunInstallRuntimeCapabilities["runtimeApiDocs"];
    pathname: string;
  }> = [
    { field: "globalsUrl", pathname: "/docs/runtime/globals" },
    { field: "bunApisUrl", pathname: "/docs/runtime/bun-apis" },
    { field: "webApisUrl", pathname: "/docs/runtime/web-apis" },
  ];

  for (const { field, pathname } of apiDocFields) {
    const url = caps.runtimeApiDocs[field];
    if (isBunComDocsUrl(url, pathname)) {
      checks.push({
        name: `runtime-api-docs:${field}`,
        status: "ok",
        message: url,
        fixable: false,
      });
    } else {
      checks.push({
        name: `runtime-api-docs:${field}`,
        status: "error",
        message: `${field} invalid: ${url}`,
        fixable: true,
      });
      fixPlan.push(`fix runtimeApiDocs.${field} in ${BUN_INSTALL_SOURCE_MODULE}`);
    }
  }

  for (const key of RUNTIME_CAPABILITY_INVENTORY_KEYS) {
    const entry = caps[key as keyof BunInstallRuntimeCapabilities];
    if (!entry || typeof entry !== "object" || !("status" in entry)) {
      checks.push({
        name: `capability:${key}`,
        status: "error",
        message: `missing capability: ${key}`,
        fixable: true,
      });
      fixPlan.push(`add ${key} to buildRuntimeCapabilities()`);
      continue;
    }
    const status = (entry as { status: string }).status;
    if (status !== "available" && status !== "active") {
      checks.push({
        name: `capability:${key}`,
        status: "error",
        message: `${key} status=${status}`,
        fixable: true,
      });
      fixPlan.push(`restore ${key} status in buildRuntimeCapabilities()`);
    } else {
      checks.push({
        name: `capability:${key}`,
        status: "ok",
        message: `${key} ${status}`,
        fixable: false,
      });
    }
  }

  const bunImageEntry = caps.bunImage;
  if (
    bunImageEntry &&
    typeof bunImageEntry.docsUrl === "string" &&
    bunImageEntry.docsUrl.startsWith(BUN_IMAGE_DOCS_URL)
  ) {
    checks.push({
      name: "bun-image:capability-docs",
      status: "ok",
      message: bunImageEntry.docsUrl,
      fixable: false,
    });
  } else {
    checks.push({
      name: "bun-image:capability-docs",
      status: "error",
      message: `bunImage docsUrl invalid: ${bunImageEntry?.docsUrl ?? "missing"}`,
      fixable: true,
    });
    fixPlan.push(`fix bunImage.docsUrl in ${BUN_INSTALL_SOURCE_MODULE}`);
  }

  const bunImageHealth = await auditBunImageHealth();
  for (const check of bunImageHealth.checks) {
    checks.push({
      name: check.name,
      status: check.status,
      message: check.message,
      fixable: check.fixable,
    });
  }
  fixPlan.push(...bunImageHealth.fixPlan);

  const bunPmHealth = await auditBunPmCliHealth(projectRoot);
  for (const check of bunPmHealth.checks) {
    checks.push({
      name: check.name,
      status: check.status,
      message: check.message,
      fixable: check.fixable,
    });
  }
  fixPlan.push(...bunPmHealth.fixPlan);

  const aligned = checks.every((check) => check.status === "ok");
  return {
    applicable: true,
    aligned,
    checks,
    fixPlan: [...new Set(fixPlan)],
    runtimeApiDocs: caps.runtimeApiDocs,
    capabilityCount: RUNTIME_CAPABILITY_INVENTORY_KEYS.length,
    ...base,
  };
}

/** Evaluate a `probe:bun-install:*` handoff condition. */
export async function evaluateBunInstallProbeHandoffCondition(
  probeId: BunInstallProbeId,
  projectRoot: string
): Promise<{ ok: boolean; message: string }> {
  const report = await auditRuntimeCapabilitiesHealth(projectRoot);
  if (!report.applicable) {
    return {
      ok: false,
      message: "bun-install runtime capabilities not applicable for this project",
    };
  }

  const suffix = probeId.slice("bun-install:".length);
  const prefix =
    suffix === "runtime-api-docs"
      ? "runtime-api-docs:"
      : suffix === "bun-image"
        ? "bun-image:"
        : suffix === "bun-pm"
          ? "bun-pm:"
          : "capability:";
  const relevant = report.checks.filter((check) => check.name.startsWith(prefix));
  const failed = relevant.filter((check) => check.status === "error");

  if (failed.length === 0) {
    if (suffix === "runtime-api-docs") {
      return { ok: true, message: "runtimeApiDocs URLs aligned with bun.com/runtime" };
    }
    if (suffix === "bun-image") {
      return {
        ok: true,
        message: "Bun.Image supported with metadata probe and docs URL aligned",
      };
    }
    if (suffix === "bun-pm") {
      return {
        ok: true,
        message: "bun pm hash, bin, and pkg get name probes aligned with docs mirror",
      };
    }
    return {
      ok: true,
      message: `all ${report.capabilityCount} inventory capabilities present`,
    };
  }

  return {
    ok: false,
    message: `${failed[0]?.message ?? "check failed"} — ${report.fixPlan[0] ?? "fix required"}`,
  };
}

/** Audit install policy: env overrides beat bunfig; flag drift from hardened defaults. */
export async function auditBunInstallConfig(projectDir: string): Promise<BunInstallConfigAudit> {
  return buildInstallPolicyReport(projectDir);
}
