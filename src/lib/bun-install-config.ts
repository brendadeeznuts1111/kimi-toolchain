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
import { BUN_WEBVIEW_DOCS_URL } from "./webview-console.ts";
import {
  BUN_DETECT_BUN_GUIDE_DOC_URL,
  BUN_VERSION_GUIDE_DOC_URL,
  bunVersion,
  detectBunRuntime,
} from "./bun-utils.ts";
import { pathExists } from "./bun-io.ts";
import { spawnBun } from "./tool-runner.ts";
import { join } from "path";
import { TOML } from "bun";
import { SecretKeys } from "./secrets-constants.ts";
import { readSecretFromEnv } from "./secrets-env.ts";

export const BUN_INSTALL_DOC_URL = "https://bun.com/docs/pm/cli/install";
/** @see https://bun.com/docs/pm/cli/update */
export const BUN_PM_UPDATE_DOC_URL = "https://bun.com/docs/pm/cli/update";
export const BUN_RELEASE_1_3_13_URL = "https://bun.com/blog/bun-v1.3.13";
export const BUN_RELEASE_1_3_13_SOURCE_MAPS_URL = `${BUN_RELEASE_1_3_13_URL}#source-maps-use-up-to-8x-less-memory`;
export const BUN_RELEASE_1_3_7_URL = "https://bun.com/blog/bun-v1.3.7";
export const BUN_BUFFER_FROM_OPTIMIZATION_URL = `${BUN_RELEASE_1_3_7_URL}#faster-buffer-from-with-arrays`;
export const BUN_HTML_STATIC_CONSOLE_DOC_URL =
  "https://bun.com/docs/bundler/html-static#echo-console-logs-from-browser-to-terminal";
export const BUN_MARKDOWN_RUN_DOC_URL = "https://bun.com/docs/runtime/markdown.md";
export const BUN_WRAP_ANSI_DOC_URL = "https://bun.com/docs/runtime/utils#bun-wrapansi";
export const BUN_JSON5_DOC_URL = "https://bun.com/docs/runtime/json5#conformance";
export const BUN_JSONL_DOC_URL = "https://bun.com/docs/runtime/jsonl";
export const BUNX_DOC_URL = "https://bun.com/docs/pm/bunx";
export const BUN_WEBVIEW_DOC_URL = BUN_WEBVIEW_DOCS_URL;
export const BUN_CRON_IN_PROCESS_DOC_URL =
  "https://bun.com/docs/runtime/cron#bun-cronschedule-handler--in-process";
export const BUN_CRON_OS_LEVEL_DOC_URL =
  "https://bun.com/docs/runtime/cron#bun-cronscript-schedule-title--os-level";
export const BUN_SLICE_ANSI_DOC_URL = "https://bun.com/docs/runtime/utils#bun-sliceansi";
export const BUN_MODULE_RESOLUTION_DOC_URL = "https://bun.com/docs/runtime/module-resolution";
export const BUN_BINARY_DATA_DOC_URL = "https://bun.com/docs/runtime/binary-data";
export const BUN_WORKSPACES_DOC_URL = "https://bun.com/docs/pm/workspaces";
export const BUN_WORKSPACES_GUIDE_DOC_URL = "https://bun.com/docs/guides/install/workspaces";
export const BUN_PM_FILTER_DOC_URL = "https://bun.com/docs/pm/filter";
export const BUN_GLOB_PATTERNS_DOC_URL =
  "https://bun.com/docs/runtime/glob#supported-glob-patterns";

/** workspace: protocol → published semver (bun.com/docs/pm/workspaces). */
export const BUN_WORKSPACE_PROTOCOL_PUBLISH_RULES = [
  { protocol: "workspace:*", publishes: "<package.json version>" },
  { protocol: "workspace:^", publishes: "^<version>" },
  { protocol: "workspace:~", publishes: "~<version>" },
  {
    protocol: "workspace:1.0.2",
    publishes: "1.0.2 (pinned protocol overrides package.json version)",
  },
] as const;
export const BUN_CATALOGS_DOC_URL = "https://bun.com/docs/pm/catalogs";
export const BUN_LINK_DOC_URL = "https://bun.com/docs/pm/cli/link";

/** Deep-link anchors from bun.com/docs (llms.txt index). */
export const BUN_WORKSPACES_GUIDE_MONOREPO_DOC_URL = `${BUN_WORKSPACES_GUIDE_DOC_URL}#configuring-a-monorepo-using-workspaces`;
export const BUN_WORKSPACES_CATALOGS_DOC_URL = `${BUN_WORKSPACES_DOC_URL}#share-versions-with-catalogs`;
export const BUN_PM_FILTER_MATCHING_DOC_URL = `${BUN_PM_FILTER_DOC_URL}#matching`;
export const BUN_CATALOGS_OVERVIEW_DOC_URL = `${BUN_CATALOGS_DOC_URL}#overview`;

/** catalog: protocol references (bun.com/docs/pm/catalogs#overview). */
export const BUN_CATALOG_PROTOCOL_REFERENCES = [
  { protocol: "catalog:", scope: "default catalog (workspaces.catalog or top-level catalog)" },
  { protocol: "catalog:testing", scope: "named catalog (workspaces.catalogs.testing)" },
] as const;
/** @see https://bun.com/docs/pm/cli/pm · https://bun.com/docs/pm/cli/pm.md */
export const BUN_PM_CLI_DOC_URL = "https://bun.com/docs/pm/cli/pm";
export const BUN_PM_CLI_PKG_DOC_URL = `${BUN_PM_CLI_DOC_URL}#pkg`;

export function bunPmCliSectionDocUrl(section: string): string {
  return `${BUN_PM_CLI_DOC_URL}#${section}`;
}

/** Dot/bracket paths from bun.com/docs/pm/cli/pm#pkg. */
export const BUN_PM_PKG_NOTATION_EXAMPLES = [
  "scripts.build",
  "contributors[0]",
  "workspaces.0",
  "scripts[test:watch]",
] as const;

/** bun pm pkg operations — dot/bracket notation (bun.com/docs/pm/cli/pm#pkg). */
export const BUN_PM_PKG_OPERATIONS = [
  {
    verb: "get",
    example: "bun pm pkg get name",
    notation: "scripts.build · contributors[0] · workspaces.0",
  },
  {
    verb: "set",
    example: 'bun pm pkg set name="my-package"',
    notation: 'scripts[test:watch] · --json · scripts.test="jest"',
  },
  {
    verb: "delete",
    example: "bun pm pkg delete description",
    notation: "scripts.test contributors[0]",
  },
  { verb: "fix", example: "bun pm pkg fix", notation: "auto-fix common package.json issues" },
] as const;

/** Subcommand inventory — mirrors bun.com/docs/pm/cli/pm.md section order. */
export const BUN_PM_CLI_SECTIONS = [
  {
    id: "pack",
    command: "bun pm pack",
    flags: [
      "--dry-run",
      "--destination",
      "--filename",
      "--ignore-scripts",
      "--gzip-level",
      "--quiet",
    ],
  },
  { id: "bin", command: "bun pm bin", alias: "bun pm bin -g" },
  { id: "ls", command: "bun pm ls", alias: "bun list · bun pm ls --all · bun pm ls --trusted" },
  { id: "whoami", command: "bun pm whoami" },
  { id: "hash", command: "bun pm hash", alias: "bun pm hash-string · bun pm hash-print" },
  { id: "cache", command: "bun pm cache", alias: "bun pm cache rm" },
  { id: "migrate", command: "bun pm migrate" },
  { id: "untrusted", command: "bun pm untrusted" },
  { id: "trust", command: "bun pm trust <names>", flags: ["--all"] },
  { id: "default-trusted", command: "bun pm default-trusted" },
  {
    id: "version",
    command: "bun pm version patch",
    increments: [
      "patch",
      "minor",
      "major",
      "prerelease",
      "prepatch",
      "preminor",
      "premajor",
      "from-git",
    ],
  },
  { id: "pkg", command: "bun pm pkg get name" },
] as const satisfies ReadonlyArray<{
  id: string;
  command: string;
  alias?: string;
  flags?: readonly string[];
  increments?: readonly string[];
}>;

export const BUN_PM_CLI_SECTION_DOC_URLS = Object.fromEntries(
  BUN_PM_CLI_SECTIONS.map((section) => [section.id, bunPmCliSectionDocUrl(section.id)])
) as Record<(typeof BUN_PM_CLI_SECTIONS)[number]["id"], string>;
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
/** @see https://bun.com/docs/runtime/semver */
export const BUN_SEMVER_DOC_URL = "https://bun.com/docs/runtime/semver";
export const BUN_RUNTIME_WEB_APIS_DOC_URL = "https://bun.com/docs/runtime/web-apis";
/** Typed API reference index (Bun.*, bun:test, etc.). @see https://bun.com/reference/bun */
export const BUN_API_REFERENCE_URL = "https://bun.com/reference/bun";
/** Bun documentation RSS feed for drift/watch workflows. */
export const BUN_DOCS_RSS_URL = "https://bun.com/rss.xml";
export const BUN_HEAP_PROF_BLOG_URL = `${BUN_RELEASE_1_3_7_URL}#heap-profiling-with-heap-prof`;
export const BUN_CGROUP_PARALLELISM_DOC_URL = `${BUN_RUNTIME_GLOBALS_DOC_URL}#navigator-hardwareconcurrency`;
export const BUN_RUNTIME_HTTP_DOC_URL = "https://bun.com/docs/runtime/http";
export const BUN_HTTPS_PROXY_KEEPALIVE_DOC_URL = `${BUN_RUNTIME_HTTP_DOC_URL}#proxying`;
export const BUN_TCP_DEFER_ACCEPT_DOC_URL = `${BUN_RUNTIME_HTTP_DOC_URL}#bun-serve`;
export const BUN_PUBLISH_DOC_URL = "https://bun.com/docs/cli/publish";
export const BUN_PUBLISH_DRY_RUN_COMMAND = "bun publish --dry-run";

/** Effect-TS documentation URLs (effect.website) — SSOT in effect-docs.ts. */
export {
  EFFECT_DOCS_URL,
  EFFECT_ENSUREING_DOC_URL,
  EFFECT_GEN_DOC_URL,
  EFFECT_LAYER_DOC_URL,
  EFFECT_RUNTIME_DOC_URL,
  EFFECT_TAGGED_ERROR_DOC_URL,
} from "./effect-docs.ts";

export function bunInstallDocAnchor(fragment: string): string {
  return `${BUN_INSTALL_DOC_URL}#${fragment}`;
}

export const BUN_INSTALL_DOCS_URL = bunInstallDocAnchor("configuring-bun-install-with-bunfig-toml");

/** Minimum Bun version this policy matrix was validated against. */
export const BUN_INSTALL_POLICY_MIN_BUN = "1.4.0";

/** Hardened package.json engines.bun range — semver gate aligned with policyMinBun. */
export const BUN_INSTALL_ENGINES_BUN_HARDENED = `>=${BUN_INSTALL_POLICY_MIN_BUN}`;

/** Last policy-matrix edit (ISO date) — bump when hardened defaults or rows change. */
export const BUN_INSTALL_POLICY_LAST_MODIFIED = "2026-06-22";

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
  installFilterExclude: "bun install --filter 'pkg-*' --filter '!pkg-c'",
  installFilterPathGlob: "bun install --filter './packages/*'",
  runFilter: "bun run --filter './examples/dashboard' <script>",
  runFilterAll: "bun --filter '*' <script>",
  runFilterParallel: "bun run --parallel --filter '*' build",
  runWorkspaces: "bun run --workspaces <script>",
  runWorkspacesSequential: "bun run --sequential --workspaces build",
  runWorkspacesIfPresent: "bun run --workspaces --if-present test",
  testFilter: "bun test --filter './examples/dashboard'",
  outdatedFilter: "bun outdated --filter './examples/dashboard'",
  pmList: "bun pm ls",
  pmListAll: "bun pm ls --all",
  pmListTrusted: "bun pm ls --trusted",
  pmPack: "bun pm pack",
  pmPackQuiet: "bun pm pack --quiet",
  pmPackDryRun: "bun pm pack --dry-run",
  pmCache: "bun pm cache",
  pmCacheRm: "bun pm cache rm",
  pmHash: "bun pm hash",
  pmHashPrint: "bun pm hash-print",
  pmBin: "bun pm bin",
  pmBinGlobal: "bun pm bin -g",
  pmUntrusted: "bun pm untrusted",
  pmTrustAll: "bun pm trust --all",
  pmMigrate: "bun pm migrate",
  pmPkgGet: "bun pm pkg get name",
  pmPkgSet: 'bun pm pkg set name="my-package"',
  pmPkgDelete: "bun pm pkg delete description",
  pmPkgFix: "bun pm pkg fix",
  pmVersion: "bun pm version patch",
  pmWhoami: "bun pm whoami",
  pmDefaultTrusted: "bun pm default-trusted",
  pmHashString: "bun pm hash-string",
  linkRegister: "bun link",
  linkConsume: "bun link <pkg>",
  linkUnlink: "bun unlink",
  linkSave: "bun link <pkg> --save",
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
    "Workspace filter:",
    `  install:      ${BUN_INSTALL_CLI.installFilter}`,
    `  multi-filter: ${BUN_INSTALL_CLI.installFilterExclude}`,
    `  run:          ${BUN_INSTALL_CLI.runFilter}`,
    `  parallel:     ${BUN_INSTALL_CLI.runFilterParallel}`,
    `  workspaces:   ${BUN_INSTALL_CLI.runWorkspaces}`,
    `  verify:       ${BUN_INSTALL_CLI.pmListAll}`,
    "bun pm:",
    `  ls:           ${BUN_INSTALL_CLI.pmList}`,
    `  ls --all:     ${BUN_INSTALL_CLI.pmListAll}`,
    `  trust:        ${BUN_INSTALL_CLI.pmTrust}`,
    `  trust --all:  ${BUN_INSTALL_CLI.pmTrustAll}`,
    `  hash:         ${BUN_INSTALL_CLI.pmHash}`,
    `  hash-print:   ${BUN_INSTALL_CLI.pmHashPrint}`,
    `  bin:          ${BUN_INSTALL_CLI.pmBin}`,
    `  pack:         ${BUN_INSTALL_CLI.pmPack}`,
    `  pack --dry:   ${BUN_INSTALL_CLI.pmPackDryRun}`,
    `  cache rm:     ${BUN_INSTALL_CLI.pmCacheRm}`,
    `  version:      ${BUN_INSTALL_CLI.pmVersion}`,
    `  migrate:      ${BUN_INSTALL_CLI.pmMigrate}`,
    `  pkg get:      ${BUN_INSTALL_CLI.pmPkgGet}`,
    `  pkg fix:      ${BUN_INSTALL_CLI.pmPkgFix}`,
    "bun link:",
    `  register:     ${BUN_INSTALL_CLI.linkRegister}`,
    `  consume:      ${BUN_INSTALL_CLI.linkConsume}`,
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
  type: "boolean" | "number" | "string" | "string[]" | "semver-range";
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
  packageManagerPin: string | null;
  enginesBun: string | null;
  policyMinBun: string;
  runtimeSatisfiesEngines: boolean;
  runtimeSatisfiesPackageManagerPin: boolean | null;
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
    notes:
      "Omit from bunfig — Bun default is ~/.bun/install/cache; tilde in bunfig/env is literal on Bun 1.4.0",
    requireExplicit: false,
  },
  {
    group: "cache",
    key: "cacheDisable",
    type: "boolean",
    officialDefault: "false",
    hardenedDefault: "false",
    bunfigKey: "[install.cache].disable",
    cliFlag: null,
    sinceBun: "1.0",
    docsAnchor: "cache",
    notes: "When true, skip global cache; may still write to node_modules/.cache",
    requireExplicit: false,
  },
  {
    group: "cache",
    key: "cacheDisableManifest",
    type: "boolean",
    officialDefault: "false",
    hardenedDefault: "false",
    bunfigKey: "[install.cache].disableManifest",
    cliFlag: null,
    sinceBun: "1.0",
    docsAnchor: "cache",
    notes: "When true, always resolve latest versions from registry (skip manifest cache)",
    requireExplicit: false,
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
    notes: "Corepack-style exact pin; must match hardened bun@ version string",
    requireExplicit: true,
  },
  {
    group: "package-json",
    key: "engines.bun",
    type: "semver-range",
    officialDefault: "unset",
    hardenedDefault: BUN_INSTALL_ENGINES_BUN_HARDENED,
    bunfigKey: null,
    cliFlag: null,
    sinceBun: "1.0",
    docsAnchor: "configuring-bun-install-with-bunfig-toml",
    notes: "Semver range gate; runtime must Bun.semver.satisfies(runtimeBun, engines.bun)",
    requireExplicit: true,
    lastModified: BUN_INSTALL_POLICY_LAST_MODIFIED,
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
      "Register runnable examples only; root scripts/postinstall stay at repo root; full glob syntax incl. negative patterns (!**/excluded/**); verify with bun pm ls --all",
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
    docsUrl: BUN_PM_CLI_DOC_URL,
  },
  {
    property: "cli.runFilter",
    type: "command",
    default: BUN_INSTALL_CLI.runFilter,
    required: false,
    description:
      "Run package.json scripts in selected workspace members (name glob, path, or ! exclusion)",
    versionAdded: "1.0",
    lastModified: BUN_INSTALL_POLICY_LAST_MODIFIED,
    docsUrl: BUN_PM_FILTER_DOC_URL,
  },
  {
    property: "cli.runWorkspaces",
    type: "command",
    default: BUN_INSTALL_CLI.runWorkspaces,
    required: false,
    description: "Run scripts across all workspace members",
    versionAdded: "1.0",
    lastModified: BUN_INSTALL_POLICY_LAST_MODIFIED,
    docsUrl: BUN_PM_FILTER_DOC_URL,
  },
  {
    property: "cli.installFilterExclude",
    type: "command",
    default: BUN_INSTALL_CLI.installFilterExclude,
    required: false,
    description:
      "Stacked --filter flags — name globs, path globs, and ! exclusions (bun.com/docs/pm/workspaces)",
    versionAdded: "1.0",
    lastModified: BUN_INSTALL_POLICY_LAST_MODIFIED,
    docsUrl: BUN_WORKSPACES_DOC_URL,
  },
  {
    property: "cli.runFilterParallel",
    type: "command",
    default: BUN_INSTALL_CLI.runFilterParallel,
    required: false,
    description: "Foreman-style prefixed output; respects workspace dependency order",
    versionAdded: "1.0",
    lastModified: BUN_INSTALL_POLICY_LAST_MODIFIED,
    docsUrl: BUN_PM_FILTER_DOC_URL,
  },
  {
    property: "cli.pmHash",
    type: "command",
    default: BUN_INSTALL_CLI.pmHash,
    required: false,
    description: "Print lockfile hash for drift detection and guardian baselines",
    versionAdded: "1.0",
    lastModified: BUN_INSTALL_POLICY_LAST_MODIFIED,
    docsUrl: BUN_PM_CLI_DOC_URL,
  },
  {
    property: "cli.pmBin",
    type: "command",
    default: BUN_INSTALL_CLI.pmBin,
    required: false,
    description: "Print local or global node_modules/.bin path",
    versionAdded: "1.0",
    lastModified: BUN_INSTALL_POLICY_LAST_MODIFIED,
    docsUrl: BUN_PM_CLI_DOC_URL,
  },
  {
    property: "cli.pmPkgFix",
    type: "command",
    default: BUN_INSTALL_CLI.pmPkgFix,
    required: false,
    description: "Auto-fix common package.json issues (bun pm pkg fix)",
    versionAdded: "1.0",
    lastModified: BUN_INSTALL_POLICY_LAST_MODIFIED,
    docsUrl: BUN_PM_CLI_PKG_DOC_URL,
  },
  {
    property: "cli.linkRegister",
    type: "command",
    default: BUN_INSTALL_CLI.linkRegister,
    required: false,
    description: "Register current package as linkable for local dev symlinks",
    versionAdded: "1.0",
    lastModified: BUN_INSTALL_POLICY_LAST_MODIFIED,
    docsUrl: BUN_LINK_DOC_URL,
  },
  {
    property: "cli.linkConsume",
    type: "command",
    default: BUN_INSTALL_CLI.linkConsume,
    required: false,
    description: "Symlink registered package into consumer node_modules; --save writes link:<pkg>",
    versionAdded: "1.0",
    lastModified: BUN_INSTALL_POLICY_LAST_MODIFIED,
    docsUrl: BUN_LINK_DOC_URL,
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
  {
    name: "BUN_INSTALL_CACHE_DIR",
    description: "global install cache (overrides bunfig; tilde is literal on Bun 1.4.0)",
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
  cache?: { dir?: string; disable?: boolean; disableManifest?: boolean };
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
  publishConfig?: {
    access?: string;
    registry?: string;
    tag?: string;
  };
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
    publishCommand: "bun publish";
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
        | "update-interactive-select-all"
        | "install-yarn-workspace-lockfile"
        | "frozen-lockfile-scope-registry"
        | "file-path-stale-lockfile-error"
        | "add-network-metadata-panic"
        | "install-security-scanner-ipc"
        | "install-proxy-304-hang"
        | "install-isolated-peer-warm-cache"
        | "npmrc-auth-hostname-match"
        | "install-scanner-error-visibility"
        | "pack-publish-lifecycle-manifest"
        | "lockfile-binary-broken-pipe";
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
  runtimeRegressionFixes: {
    status: "tracked";
    fixes: readonly {
      id:
        | "test-diff-empty-string-keys"
        | "shell-interpolation-crash"
        | "shell-rm-quiet-exit-code"
        | "types-s3-content-encoding"
        | "run-filter-node-executable"
        | "inotify-stale-events-cpu"
        | "builtin-proxy-array-crash";
      command: string;
      surface: string;
      regression: string;
      expected: string;
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
  bunx: {
    status: "available";
    command: string;
    description: string;
    docsUrl: typeof BUNX_DOC_URL;
    flags: readonly ["--bun", "--package", "--no-install", "--verbose", "--silent"];
    equivalentTo: readonly ["npx", "yarn dlx"];
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
  osLevelCron: {
    status: "active";
    command: string;
    description: string;
    docsUrl: typeof BUN_CRON_OS_LEVEL_DOC_URL;
    platforms: readonly ["linux", "darwin", "win32"];
    backends: readonly ["crontab", "launchd", "schtasks"];
  };
  sliceAnsi: {
    status: "available";
    command: string;
    description: string;
    docsUrl: typeof BUN_SLICE_ANSI_DOC_URL;
  };
  bunPublish: {
    status: "active";
    command: typeof BUN_PUBLISH_DRY_RUN_COMMAND;
    description: string;
    docsUrl: typeof BUN_PUBLISH_DOC_URL;
    streams: readonly ["stdout"];
    hmr: false;
  };
  workspaceFilter: {
    status: "active";
    installCommand: typeof BUN_INSTALL_CLI.installFilter;
    installFilterMulti: typeof BUN_INSTALL_CLI.installFilterExclude;
    runCommand: typeof BUN_INSTALL_CLI.runFilter;
    runFilterAll: typeof BUN_INSTALL_CLI.runFilterAll;
    workspacesCommand: typeof BUN_INSTALL_CLI.runWorkspaces;
    testCommand: typeof BUN_INSTALL_CLI.testFilter;
    outdatedCommand: typeof BUN_INSTALL_CLI.outdatedFilter;
    description: string;
    docsUrl: typeof BUN_PM_FILTER_DOC_URL;
    filterMatchingDocsUrl: typeof BUN_PM_FILTER_MATCHING_DOC_URL;
    workspacesDocsUrl: typeof BUN_WORKSPACES_DOC_URL;
    workspacesGuideUrl: typeof BUN_WORKSPACES_GUIDE_DOC_URL;
    workspacesGuideMonorepoUrl: typeof BUN_WORKSPACES_GUIDE_MONOREPO_DOC_URL;
    workspacesCatalogsSectionUrl: typeof BUN_WORKSPACES_CATALOGS_DOC_URL;
    catalogsDocsUrl: typeof BUN_CATALOGS_OVERVIEW_DOC_URL;
    globDocsUrl: typeof BUN_GLOB_PATTERNS_DOC_URL;
    workspaceProtocols: typeof BUN_WORKSPACE_PROTOCOL_PUBLISH_RULES;
    patterns: readonly string[];
    verbs: readonly string[];
    flags: readonly ["--filter", "--workspaces"];
    parallelFlags: readonly string[];
    notes: string;
  };
  workspaceCatalogs: {
    status: "available";
    description: string;
    docsUrl: typeof BUN_CATALOGS_OVERVIEW_DOC_URL;
    workspacesSectionUrl: typeof BUN_WORKSPACES_CATALOGS_DOC_URL;
    protocols: typeof BUN_CATALOG_PROTOCOL_REFERENCES;
    rootFields: readonly string[];
    publishBehavior: string;
    notes: string;
  };
  bunLink: {
    status: "active";
    registerCommand: typeof BUN_INSTALL_CLI.linkRegister;
    consumeCommand: typeof BUN_INSTALL_CLI.linkConsume;
    unlinkCommand: typeof BUN_INSTALL_CLI.linkUnlink;
    saveCommand: typeof BUN_INSTALL_CLI.linkSave;
    versionSpecifier: "link:<pkg>";
    docsUrl: typeof BUN_LINK_DOC_URL;
    notes: string;
  };
  bunPmCli: {
    status: "active";
    description: string;
    docsUrl: typeof BUN_PM_CLI_DOC_URL;
    pkgDocsUrl: typeof BUN_PM_CLI_PKG_DOC_URL;
    sections: typeof BUN_PM_CLI_SECTIONS;
    sectionDocs: typeof BUN_PM_CLI_SECTION_DOC_URLS;
    pkgNotationExamples: typeof BUN_PM_PKG_NOTATION_EXAMPLES;
    pkgOperations: typeof BUN_PM_PKG_OPERATIONS;
    listAlias: "bun list";
    subcommands: readonly string[];
    commands: {
      trust: typeof BUN_INSTALL_CLI.pmTrust;
      trustAll: typeof BUN_INSTALL_CLI.pmTrustAll;
      list: typeof BUN_INSTALL_CLI.pmList;
      listAll: typeof BUN_INSTALL_CLI.pmListAll;
      listTrusted: typeof BUN_INSTALL_CLI.pmListTrusted;
      pack: typeof BUN_INSTALL_CLI.pmPack;
      packQuiet: typeof BUN_INSTALL_CLI.pmPackQuiet;
      packDryRun: typeof BUN_INSTALL_CLI.pmPackDryRun;
      cache: typeof BUN_INSTALL_CLI.pmCache;
      cacheRm: typeof BUN_INSTALL_CLI.pmCacheRm;
      bin: typeof BUN_INSTALL_CLI.pmBin;
      binGlobal: typeof BUN_INSTALL_CLI.pmBinGlobal;
      hash: typeof BUN_INSTALL_CLI.pmHash;
      hashString: typeof BUN_INSTALL_CLI.pmHashString;
      hashPrint: typeof BUN_INSTALL_CLI.pmHashPrint;
      migrate: typeof BUN_INSTALL_CLI.pmMigrate;
      untrusted: typeof BUN_INSTALL_CLI.pmUntrusted;
      defaultTrusted: typeof BUN_INSTALL_CLI.pmDefaultTrusted;
      version: typeof BUN_INSTALL_CLI.pmVersion;
      whoami: typeof BUN_INSTALL_CLI.pmWhoami;
      pkgGet: typeof BUN_INSTALL_CLI.pmPkgGet;
      pkgSet: typeof BUN_INSTALL_CLI.pmPkgSet;
      pkgDelete: typeof BUN_INSTALL_CLI.pmPkgDelete;
      pkgFix: typeof BUN_INSTALL_CLI.pmPkgFix;
    };
    notes: string;
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
    apiReferenceUrl: typeof BUN_API_REFERENCE_URL;
    docsRssUrl: typeof BUN_DOCS_RSS_URL;
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
    case "cacheDisable":
      return install?.cache?.disable == null ? null : formatDisplayValue(install.cache.disable);
    case "cacheDisableManifest":
      return install?.cache?.disableManifest == null
        ? null
        : formatDisplayValue(install.cache.disableManifest);
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

/** Parse `bun@1.4.0` / `bun@1.4.0+sha` into a semver version string. */
export function parsePackageManagerPin(value: string | null | undefined): string | null {
  if (!value?.startsWith("bun@")) return null;
  const pin = value.slice(4).split("+")[0]?.trim();
  return pin || null;
}

/** Exact pin gate — packageManager must match hardened `bun@x.y.z` string. */
export function comparePackageManagerPolicy(
  current: string | null,
  hardened: string
): BunInstallPolicyStatus {
  if (current == null) return "missing";
  if (current === hardened) return "ok";
  const pin = parsePackageManagerPin(current);
  const hardenedPin = parsePackageManagerPin(hardened);
  if (!pin || !hardenedPin) return "drift";
  if (Bun.semver.order(pin, hardenedPin) < 0) return "drift";
  return "drift";
}

const ENGINES_BUN_PROBE_BELOW_MIN = "1.3.99";

/** Semver range gate — must require at least policyMinBun (weaker ranges like >=1.0.0 drift). */
export function compareEnginesBunPolicy(
  current: string | null,
  hardened: string
): BunInstallPolicyStatus {
  if (current == null) return "missing";
  if (current === hardened) return "ok";
  if (!Bun.semver.satisfies(BUN_INSTALL_POLICY_MIN_BUN, current)) return "drift";
  if (Bun.semver.satisfies(ENGINES_BUN_PROBE_BELOW_MIN, current)) return "drift";
  return "ok";
}

/** Unified Bun version policy snapshot for runtime:deep, doctor, and dashboard. */
export interface BunVersionPolicySnapshot {
  policyMinBun: string;
  enginesRangeHardened: string;
  packageManagerHardened: string;
  runtimeBun: string;
  enginesBun: string | null;
  packageManager: string | null;
  packageManagerPin: string | null;
  runtimeSatisfiesEngines: boolean;
  runtimeSatisfiesPackageManagerPin: boolean | null;
  liveSurfacesUnversioned: true;
  summary: string;
}

/** Agent-facing Bun version policy — pin (exact) + engines (range) from one SSOT. */
export function describeBunVersionPolicy(meta?: {
  enginesBun?: string | null;
  packageManager?: string | null;
}): BunVersionPolicySnapshot {
  const runtimeBun = bunVersion();
  const enginesBun = meta?.enginesBun ?? null;
  const packageManager = meta?.packageManager ?? null;
  const enginesRange = enginesBun ?? BUN_INSTALL_ENGINES_BUN_HARDENED;
  const packageManagerPin = parsePackageManagerPin(packageManager);
  const packageManagerHardened = `bun@${BUN_INSTALL_POLICY_MIN_BUN}`;
  const runtimeSatisfiesEngines = Bun.semver.satisfies(runtimeBun, enginesRange);
  const runtimeSatisfiesPackageManagerPin =
    packageManagerPin == null ? null : Bun.semver.order(runtimeBun, packageManagerPin) >= 0;

  return {
    policyMinBun: BUN_INSTALL_POLICY_MIN_BUN,
    enginesRangeHardened: BUN_INSTALL_ENGINES_BUN_HARDENED,
    packageManagerHardened,
    runtimeBun,
    enginesBun,
    packageManager,
    packageManagerPin,
    runtimeSatisfiesEngines,
    runtimeSatisfiesPackageManagerPin,
    liveSurfacesUnversioned: true,
    summary: `pin ${packageManagerHardened} · engines ${BUN_INSTALL_ENGINES_BUN_HARDENED} · MCP/docs unversioned`,
  };
}

function comparePolicyStatus(
  def: BunInstallPolicyRowDef,
  current: string | null
): BunInstallPolicyStatus {
  if (current == null) {
    if (!def.requireExplicit && def.officialDefault === def.hardenedDefault) return "ok";
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
  if (key === "engines.bun") {
    return meta.engines?.bun ?? null;
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
        : def.key === "packageManager"
          ? comparePackageManagerPolicy(current, def.hardenedDefault)
          : def.key === "engines.bun"
            ? compareEnginesBunPolicy(current, def.hardenedDefault)
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

/** Test, shell, types, and runtime/CLI regressions tracked alongside packageManagerFixes. */
export const BUN_RUNTIME_REGRESSION_FIXES = [
  {
    id: "test-diff-empty-string-keys",
    command: "bun test",
    surface: "expect() object diffs and console.log serialization",
    regression:
      'object diffs and console.log silently dropped properties with empty string keys ("")',
    expected: "empty-string keys appear in expect diffs and console.log output",
  },
  {
    id: "shell-interpolation-crash",
    command: "bun shell",
    surface: "shell string interpolation",
    regression: "shell interpolation could crash on invalid input",
    expected: "invalid interpolation input fails safely without crashing the shell",
  },
  {
    id: "shell-rm-quiet-exit-code",
    command: "bun shell",
    surface: "builtin rm (.quiet / .text)",
    regression:
      "builtin rm returned exit 0 when the target file was missing with .quiet() or .text(), suppressing thrown errors",
    expected: "missing-file rm paths return non-zero exit codes and throw when appropriate",
  },
  {
    id: "types-s3-content-encoding",
    command: "bun types",
    surface: "S3Options TypeScript definition",
    regression: "contentEncoding missing from S3Options types (runtime option added in Bun v1.3.7)",
    expected: "S3Options.contentEncoding is typed for IDE autocompletion and tsc",
  },
  {
    id: "run-filter-node-executable",
    command: "bun run --filter · bun run --workspaces",
    surface: "NODE env for workspace scripts",
    regression: "bun run --filter/--workspaces failed when NODE pointed at a non-existent file",
    expected: "Bun validates NODE is executable, then falls back to PATH or its own node symlink",
  },
  {
    id: "inotify-stale-events-cpu",
    command: "bun --watch",
    surface: "Linux inotify file watcher",
    regression:
      "inotify watcher re-parsed stale events in an infinite loop when read() returned >128 events (100% CPU)",
    expected: "stale inotify batches are drained without spinning the event loop",
  },
  {
    id: "builtin-proxy-array-crash",
    command: "bun",
    surface: "built-in APIs accepting arrays",
    regression: "Proxy-wrapped arrays passed to built-in APIs could crash the runtime",
    expected: "built-in APIs accept Proxy-wrapped arrays without crashing",
  },
] as const satisfies ReadonlyArray<{
  id: BunInstallRuntimeCapabilities["runtimeRegressionFixes"]["fixes"][number]["id"];
  command: string;
  surface: string;
  regression: string;
  expected: string;
}>;

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
        "Bun 1.3.13+ accelerates peer-heavy installs with the isolated linker while preserving the final .bun store layout. Transitive peer symlinks now resolve deterministically on warm-cache synchronous manifest loads (Cache-Control: max-age).",
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
      publishCommand: "bun publish",
      lifecycleScripts: ["prepack", "prepare", "prepublishOnly"],
      packageJsonBehavior: "re-read after lifecycle scripts",
      notes:
        "Bun re-reads package.json after pack/publish lifecycle scripts so tarball filename, packed metadata, and registry publish fields reflect prepublishOnly/prepack/prepare mutations (not stale pre-script name/version).",
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
            'stale lockfile file: paths reported misleading "Bun could not find a package.json file to install from"',
          expected:
            "file: errors name the dependency and the exact missing path that was not found",
        },
        {
          id: "add-network-metadata-panic",
          command: BUN_INSTALL_CLI.add,
          surface: "network failure handling",
          regression:
            "HTTP failures before response headers could panic with Expected metadata to be set",
          expected: "network failures return a normal package-manager error instead of panicking",
        },
        {
          id: "install-security-scanner-ipc",
          command: BUN_INSTALL_CLI.install,
          surface: "security scanner subprocess",
          regression:
            "projects with ~790+ packages hung indefinitely or silently skipped scanning when argv exceeded OS limits",
          expected:
            "package list sent to the scanner via IPC pipe instead of command-line arguments",
        },
        {
          id: "install-proxy-304-hang",
          command: BUN_INSTALL_CLI.install,
          surface: "http_proxy/https_proxy cached installs",
          regression:
            "~300 second hang per dependency on 304 Not Modified through HTTP proxy CONNECT tunnels",
          expected: "proxy cache revalidation completes without per-dependency stalls",
        },
        {
          id: "install-isolated-peer-warm-cache",
          command: `${BUN_INSTALL_CLI.install} --linker=isolated`,
          surface: "transitive peer dependency resolution",
          regression:
            "synchronous warm-cache manifest loads left transitive peer symlinks unresolved with --linker=isolated",
          expected:
            "peer dependencies resolve deterministically even when Cache-Control: max-age is valid",
        },
        {
          id: "npmrc-auth-hostname-match",
          command: BUN_INSTALL_CLI.install,
          surface: ".npmrc auth token matching",
          regression: ".npmrc auth token matching compared hostnames only",
          expected: "registry auth tokens match full registry URL identity (not hostname-only)",
        },
        {
          id: "install-scanner-error-visibility",
          command: BUN_INSTALL_CLI.install,
          surface: "security scanner failures",
          regression:
            "scanner errors exited 1 silently with no stderr, making CI failures impossible to debug",
          expected: "all scanner error paths print descriptive messages to stderr",
        },
        {
          id: "update-interactive-select-all",
          command: BUN_INSTALL_CLI.updateInteractive,
          surface: "interactive update select-all",
          regression:
            "pressing A to select all in bun update -i showed No packages selected for update",
          expected: "select-all updates every listed package instead of clearing the selection",
        },
        {
          id: "pack-publish-lifecycle-manifest",
          command: "bun pm pack · bun publish",
          surface: "pack/publish tarball metadata",
          regression:
            "tarball filename and publish registry metadata used package.json name/version captured before lifecycle scripts ran",
          expected:
            "post-lifecycle package.json name/version drive tarball filename and registry metadata",
        },
        {
          id: "lockfile-binary-broken-pipe",
          command: "bun bun.lockb",
          surface: "binary lockfile stdout piping",
          regression: "piping bun bun.lockb to head printed an internal BrokenPipe error",
          expected: "BrokenPipe on truncated stdout exits silently",
        },
      ],
    },
    runtimeRegressionFixes: {
      status: "tracked",
      fixes: BUN_RUNTIME_REGRESSION_FIXES,
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
        "Bun buffers console output per test file under --parallel and flushes each file atomically so concurrent files do not interleave. expect() diffs and console.log now retain properties with empty-string keys.",
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
    bunx: {
      status: "available",
      command: 'bunx cowsay "Hello world!"',
      description:
        "Auto-install and run npm package executables; Bun's equivalent of npx/yarn dlx; --bun forces Bun runtime",
      docsUrl: BUNX_DOC_URL,
      flags: ["--bun", "--package", "--no-install", "--verbose", "--silent"],
      equivalentTo: ["npx", "yarn dlx"],
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
        "In-process UTC cron scheduler — no overlap, --hot safe, ref/unref; shares application state; OS-level registration also available via Bun.cron(script, schedule, title)",
      docsUrl: BUN_CRON_IN_PROCESS_DOC_URL,
      streams: ["stdout"],
      hmr: true,
    },
    osLevelCron: {
      status: "active",
      command: "bun -e \"await Bun.cron('./worker.ts', '30 2 * * MON', 'weekly-report')\"",
      description:
        "OS-level cron registration — crontab (Linux), launchd plist (macOS), schtasks (Windows); Bun.cron.parse() for expression parsing, Bun.cron.remove() for teardown",
      docsUrl: BUN_CRON_OS_LEVEL_DOC_URL,
      platforms: ["linux", "darwin", "win32"],
      backends: ["crontab", "launchd", "schtasks"],
    },
    sliceAnsi: {
      status: "available",
      command: "bun -e 'console.log(Bun.sliceAnsi(\"\\x1b[31mhello\\x1b[39m\", 1, 4))'",
      description:
        "ANSI- and grapheme-aware string slicing — replaces slice-ansi and cli-truncate; preserves SGR colors, OSC 8 hyperlinks; supports negative indices and ellipsis",
      docsUrl: BUN_SLICE_ANSI_DOC_URL,
    },
    bunPublish: {
      status: "active",
      command: BUN_PUBLISH_DRY_RUN_COMMAND,
      description:
        "Native bun publish (pack + lifecycle scripts + registry push) with dry-run guard; re-reads package.json after prepublishOnly/prepack/prepare",
      docsUrl: BUN_PUBLISH_DOC_URL,
      streams: ["stdout"],
      hmr: false,
    },
    workspaceFilter: {
      status: "active",
      installCommand: BUN_INSTALL_CLI.installFilter,
      installFilterMulti: BUN_INSTALL_CLI.installFilterExclude,
      runCommand: BUN_INSTALL_CLI.runFilter,
      runFilterAll: BUN_INSTALL_CLI.runFilterAll,
      workspacesCommand: BUN_INSTALL_CLI.runWorkspaces,
      testCommand: BUN_INSTALL_CLI.testFilter,
      outdatedCommand: BUN_INSTALL_CLI.outdatedFilter,
      description:
        "Monorepo workspace selection — name globs (pkg-*), path globs (./packages/**), ! exclusions, and --workspaces for all members; respects package.json workspaces globs incl. negatives",
      docsUrl: BUN_PM_FILTER_DOC_URL,
      filterMatchingDocsUrl: BUN_PM_FILTER_MATCHING_DOC_URL,
      workspacesDocsUrl: BUN_WORKSPACES_DOC_URL,
      workspacesGuideUrl: BUN_WORKSPACES_GUIDE_DOC_URL,
      workspacesGuideMonorepoUrl: BUN_WORKSPACES_GUIDE_MONOREPO_DOC_URL,
      workspacesCatalogsSectionUrl: BUN_WORKSPACES_CATALOGS_DOC_URL,
      catalogsDocsUrl: BUN_CATALOGS_OVERVIEW_DOC_URL,
      globDocsUrl: BUN_GLOB_PATTERNS_DOC_URL,
      workspaceProtocols: BUN_WORKSPACE_PROTOCOL_PUBLISH_RULES,
      patterns: [
        "pkg-*",
        "./packages/pkg-*",
        "./examples/*",
        "!pkg-c",
        "!./",
        "@workspace:examples/dashboard",
      ],
      verbs: ["install", "run", "test", "outdated", "add", "remove"],
      flags: ["--filter", "--workspaces"],
      parallelFlags: ["--parallel", "--sequential", "--if-present", "--no-exit-on-error"],
      notes:
        "kimi-toolchain Path A: examples/* only (templates stay scaffolding); root consumers use file:../.. not workspace:*. Publish replaces workspace: with semver. Parallel runs respect dependency order. Verify: bun pm ls --all.",
    },
    workspaceCatalogs: {
      status: "available",
      description:
        "Share dependency versions across workspace packages — define catalog/catalogs in root package.json, reference with catalog: protocol",
      docsUrl: BUN_CATALOGS_OVERVIEW_DOC_URL,
      workspacesSectionUrl: BUN_WORKSPACES_CATALOGS_DOC_URL,
      protocols: BUN_CATALOG_PROTOCOL_REFERENCES,
      rootFields: ["workspaces.catalog", "workspaces.catalogs", "catalog", "catalogs"],
      publishBehavior:
        "bun publish / bun pm pack resolve catalog: to semver in published package.json",
      notes:
        "kimi-toolchain does not use catalogs today; lockfile tracks catalog defs when enabled. See workspaces#share-versions-with-catalogs.",
    },
    bunLink: {
      status: "active",
      registerCommand: BUN_INSTALL_CLI.linkRegister,
      consumeCommand: BUN_INSTALL_CLI.linkConsume,
      unlinkCommand: BUN_INSTALL_CLI.linkUnlink,
      saveCommand: BUN_INSTALL_CLI.linkSave,
      versionSpecifier: "link:<pkg>",
      docsUrl: BUN_LINK_DOC_URL,
      notes:
        "Register local packages (bun link) then symlink into consumers (bun link <pkg>); --save writes link:<pkg> to package.json. Distinct from workspace:* and file:../..",
    },
    bunPmCli: {
      status: "active",
      description:
        "Native bun pm utilities per bun.com/docs/pm/cli/pm — pack, bin, ls, whoami, hash, cache, migrate, untrusted, trust, default-trusted, version, pkg",
      docsUrl: BUN_PM_CLI_DOC_URL,
      pkgDocsUrl: BUN_PM_CLI_PKG_DOC_URL,
      sections: BUN_PM_CLI_SECTIONS,
      sectionDocs: BUN_PM_CLI_SECTION_DOC_URLS,
      pkgNotationExamples: BUN_PM_PKG_NOTATION_EXAMPLES,
      pkgOperations: BUN_PM_PKG_OPERATIONS,
      listAlias: "bun list",
      subcommands: BUN_PM_CLI_SECTIONS.map((section) => section.id),
      commands: {
        trust: BUN_INSTALL_CLI.pmTrust,
        trustAll: BUN_INSTALL_CLI.pmTrustAll,
        list: BUN_INSTALL_CLI.pmList,
        listAll: BUN_INSTALL_CLI.pmListAll,
        listTrusted: BUN_INSTALL_CLI.pmListTrusted,
        pack: BUN_INSTALL_CLI.pmPack,
        packQuiet: BUN_INSTALL_CLI.pmPackQuiet,
        packDryRun: BUN_INSTALL_CLI.pmPackDryRun,
        cache: BUN_INSTALL_CLI.pmCache,
        cacheRm: BUN_INSTALL_CLI.pmCacheRm,
        bin: BUN_INSTALL_CLI.pmBin,
        binGlobal: BUN_INSTALL_CLI.pmBinGlobal,
        hash: BUN_INSTALL_CLI.pmHash,
        hashString: BUN_INSTALL_CLI.pmHashString,
        hashPrint: BUN_INSTALL_CLI.pmHashPrint,
        migrate: BUN_INSTALL_CLI.pmMigrate,
        untrusted: BUN_INSTALL_CLI.pmUntrusted,
        defaultTrusted: BUN_INSTALL_CLI.pmDefaultTrusted,
        version: BUN_INSTALL_CLI.pmVersion,
        whoami: BUN_INSTALL_CLI.pmWhoami,
        pkgGet: BUN_INSTALL_CLI.pmPkgGet,
        pkgSet: BUN_INSTALL_CLI.pmPkgSet,
        pkgDelete: BUN_INSTALL_CLI.pmPkgDelete,
        pkgFix: BUN_INSTALL_CLI.pmPkgFix,
      },
      notes:
        "SSOT mirrors pm.md section order; bun pm trust --all for bulk lifecycle approval; bun pm pack --quiet for automation; bun pm pkg uses dot/bracket notation.",
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
        "Canonical runtime API discovery — narrative indexes, typed reference (Bun.*), and docs RSS",
      globalsUrl: BUN_RUNTIME_GLOBALS_DOC_URL,
      bunApisUrl: BUN_RUNTIME_BUN_APIS_DOC_URL,
      webApisUrl: BUN_RUNTIME_WEB_APIS_DOC_URL,
      apiReferenceUrl: BUN_API_REFERENCE_URL,
      docsRssUrl: BUN_DOCS_RSS_URL,
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
        'bun -e \'fetch("https://example.com", {proxy: "http://user:pass@proxy.example.com:8080"}).then(()=>process.exit(0)).catch(()=>process.exit(0))\'', // kimi-audit:ignore-hardcoded-secret (proxy example URL)
      description:
        "HTTPS proxy CONNECT tunnel reuse (Keep-Alive) for fetch — reduces connection overhead; install cache 304 revalidation no longer stalls ~300s per dependency",
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

  const runtimeBun = bunVersion();
  const packageManager = packageMeta?.packageManager ?? null;
  const packageManagerPin = parsePackageManagerPin(packageManager);
  const enginesBun = packageMeta?.engines?.bun ?? null;
  const enginesRange = enginesBun ?? BUN_INSTALL_ENGINES_BUN_HARDENED;
  const runtimeSatisfiesEngines = Bun.semver.satisfies(runtimeBun, enginesRange);
  const runtimeSatisfiesPackageManagerPin =
    packageManagerPin == null ? null : Bun.semver.order(runtimeBun, packageManagerPin) >= 0;

  const versions: BunInstallVersionInfo = {
    runtimeBun,
    packageManager,
    packageManagerPin,
    enginesBun,
    policyMinBun: BUN_INSTALL_POLICY_MIN_BUN,
    runtimeSatisfiesEngines,
    runtimeSatisfiesPackageManagerPin,
    docsUrl: BUN_INSTALL_DOC_URL,
  };

  if (!runtimeSatisfiesEngines) {
    warnings.push(
      `runtime Bun ${runtimeBun} does not satisfy engines.bun ${enginesRange} — upgrade Bun or widen engines`
    );
  }
  if (runtimeSatisfiesPackageManagerPin === false) {
    warnings.push(
      `runtime Bun ${runtimeBun} is below packageManager pin bun@${packageManagerPin} — align runtime with Corepack pin`
    );
  }

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
    `Bun ${report.versions.runtimeBun} | policy≥${report.versions.policyMinBun} | engines ok=${report.versions.runtimeSatisfiesEngines} | packageManager=${report.versions.packageManager ?? "unset"} | engines.bun=${report.versions.enginesBun ?? "unset"}`,
    `Docs: ${report.versions.docsUrl}`,
    "Install runtime:",
    `  streamingExtraction: ${report.runtimeCapabilities.streamingExtraction.status} (disable: ${report.runtimeCapabilities.streamingExtraction.disableEnv}=1)`,
    `  isolatedLinkerFastPath: ${report.runtimeCapabilities.isolatedLinkerFastPath.status} (${report.runtimeCapabilities.isolatedLinkerFastPath.cliFlag}; current=${report.runtimeCapabilities.isolatedLinkerFastPath.linker ?? "unset"})`,
    `  sourceMapsMemory: ${report.runtimeCapabilities.sourceMapsMemory.status} (Bun 1.3.13+ compact maps)`,
    `  pmPackLifecycleManifest: ${report.runtimeCapabilities.pmPackLifecycleManifest.status} (${report.runtimeCapabilities.pmPackLifecycleManifest.command})`,
    `  inspectorProfiler: ${report.runtimeCapabilities.inspectorProfiler.status} (${report.runtimeCapabilities.inspectorProfiler.profileFormat})`,
    `  ffiCompilerPaths: ${report.runtimeCapabilities.ffiCompilerPaths.status} (${report.runtimeCapabilities.ffiCompilerPaths.module})`,
    `  packageManagerFixes: ${report.runtimeCapabilities.packageManagerFixes.status} (${report.runtimeCapabilities.packageManagerFixes.fixes.length} fixes)`,
    `  runtimeRegressionFixes: ${report.runtimeCapabilities.runtimeRegressionFixes.status} (${report.runtimeCapabilities.runtimeRegressionFixes.fixes.length} fixes)`,
    `  timerIdleStart: ${report.runtimeCapabilities.timerIdleStart.status} (${report.runtimeCapabilities.timerIdleStart.property})`,
    `  parallelConsole: ${report.runtimeCapabilities.parallelConsole.status} (${report.runtimeCapabilities.parallelConsole.flush})`,
    `  htmlStaticConsoleEcho: ${report.runtimeCapabilities.htmlStaticConsoleEcho.status} (${report.runtimeCapabilities.htmlStaticConsoleEcho.flag})`,
    `  markdownTerminalRender: ${report.runtimeCapabilities.markdownTerminalRender.status}`,
    `  wrapAnsi: ${report.runtimeCapabilities.wrapAnsi.status}`,
    `  json5Native: ${report.runtimeCapabilities.json5Native.status}`,
    `  jsonlStreaming: ${report.runtimeCapabilities.jsonlStreaming.status}`,
    `  webView: ${report.runtimeCapabilities.webView.status}`,
    `  inProcessCron: ${report.runtimeCapabilities.inProcessCron.status}`,
    `  bunPublish: ${report.runtimeCapabilities.bunPublish.status} (${report.runtimeCapabilities.bunPublish.command})`,
    `  cpuProfMarkdown: ${report.runtimeCapabilities.cpuProfMarkdown.status} (--cpu-prof-md)`,
    `  heapProf: ${report.runtimeCapabilities.heapProf.status} (--heap-prof / --heap-prof-md)`,
    `  jscHeapStats: ${report.runtimeCapabilities.jscHeapStats.status} (${report.runtimeCapabilities.jscHeapStats.module})`,
    `  measuringTime: ${report.runtimeCapabilities.measuringTime.status}`,
    `  publicBenchmarks: ${report.runtimeCapabilities.publicBenchmarks.status} (${report.runtimeCapabilities.publicBenchmarks.path})`,
    `  runtimeApiDocs: ${report.runtimeCapabilities.runtimeApiDocs.status} (globals · bun-apis · web-apis · reference · rss)`,
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
  "osLevelCron",
  "sliceAnsi",
  "bunPublish",
  "workspaceFilter",
  "workspaceCatalogs",
  "bunLink",
  "bunPmCli",
  "bunImage",
  "cgroupAwareParallelism",
  "httpsProxyKeepAlive",
  "tcpDeferAccept",
] as const;

export const BUN_INSTALL_INSPECT_COMMAND = "bun run bun-install:status --json";
export const BUN_INSTALL_SOURCE_MODULE = "src/lib/bun-install-config.ts";

export type BunInstallProbeSuffix =
  | "runtime-api-docs"
  | "capabilities"
  | "bun-image"
  | "bunPublish"
  | "publish-dry-run"
  | "workspace-filter"
  | "workspace-catalogs"
  | "bun-pm"
  | "bun-link";
export type BunInstallProbeId = `bun-install:${BunInstallProbeSuffix}`;

const BUN_INSTALL_PROBE_SUFFIXES: readonly BunInstallProbeSuffix[] = [
  "runtime-api-docs",
  "capabilities",
  "bun-image",
  "bunPublish",
  "publish-dry-run",
  "workspace-filter",
  "workspace-catalogs",
  "bun-pm",
  "bun-link",
];

/** Workspace members listed by `bun pm ls --all` for filter probe validation. */
export const WORKSPACE_FILTER_PROBE_MARKER = "@workspace:examples/";

export interface RuntimeCapabilitiesHealthCheck {
  name: string;
  status: "ok" | "error" | "warn";
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

function hasPublishRegistryToken(): boolean {
  return Boolean(readSecretFromEnv(SecretKeys.NPM_TOKEN.service, SecretKeys.NPM_TOKEN.name));
}

function buildPublishRegistryChecks(
  packageMeta: PackageJsonInstallMeta | null
): RuntimeCapabilitiesHealthCheck[] {
  const checks: RuntimeCapabilitiesHealthCheck[] = [];
  const scoped = packageMeta?.name?.startsWith("@") ?? false;
  const access = packageMeta?.publishConfig?.access;

  if (scoped && !access) {
    checks.push({
      name: "publish:registry-access",
      status: "warn",
      message:
        "scoped package missing publishConfig.access — set public or restricted before release",
      fixable: true,
    });
  } else if (access) {
    checks.push({
      name: "publish:registry-access",
      status: "ok",
      message: `publishConfig.access=${access}`,
      fixable: false,
    });
  } else {
    checks.push({
      name: "publish:registry-access",
      status: "ok",
      message: "unscoped package — public by default",
      fixable: false,
    });
  }

  if (hasPublishRegistryToken()) {
    checks.push({
      name: "publish:registry-token",
      status: "ok",
      message: "NPM_CONFIG_TOKEN or NPM_TOKEN present",
      fixable: false,
    });
  } else {
    checks.push({
      name: "publish:registry-token",
      status: "warn",
      message:
        "no NPM_CONFIG_TOKEN/NPM_TOKEN — required for real publish; dry-run still works locally",
      fixable: true,
    });
  }

  return checks;
}

export interface BunPublishDryRunAudit {
  ok: boolean;
  message: string;
  exitCode: number | null;
  command: typeof BUN_PUBLISH_DRY_RUN_COMMAND;
}

function isPublishPackSuccessful(output: string): boolean {
  return /Total files:\s*\d+/i.test(output) && /Unpacked size:/i.test(output);
}

function isPublishAuthOnlyFailure(output: string, exitCode: number | null): boolean {
  if (exitCode === 0) return false;
  return (
    isPublishPackSuccessful(output) && /missing authentication|npm login|ENEEDAUTH/i.test(output)
  );
}

function isPublishPrivatePackageFailure(output: string): boolean {
  return /attempted to publish a private package/i.test(output);
}

export interface BunPmCliAudit {
  ok: boolean;
  message: string;
  exitCode: number | null;
  hashCommand: typeof BUN_INSTALL_CLI.pmHash;
  binCommand: typeof BUN_INSTALL_CLI.pmBin;
  pkgGetCommand: typeof BUN_INSTALL_CLI.pmPkgGet;
  packDryRunCommand: typeof BUN_INSTALL_CLI.pmPackDryRun;
}

export interface WorkspaceFilterAudit {
  ok: boolean;
  message: string;
  exitCode: number | null;
  command: typeof BUN_INSTALL_CLI.pmListAll;
  marker: typeof WORKSPACE_FILTER_PROBE_MARKER;
}

/** Verify `bun pm ls --all` lists workspace members for filter workflows. */
export async function auditWorkspaceFilterHealth(
  projectRoot: string
): Promise<WorkspaceFilterAudit> {
  const result = await spawnBun(["pm", "ls", "--all"], {
    cwd: projectRoot,
    timeoutMs: 30_000,
    maxOutputBytes: 512_000,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const listsWorkspaces = result.exitCode === 0 && output.includes(WORKSPACE_FILTER_PROBE_MARKER);
  return {
    ok: listsWorkspaces,
    command: BUN_INSTALL_CLI.pmListAll,
    marker: WORKSPACE_FILTER_PROBE_MARKER,
    exitCode: result.exitCode,
    message: listsWorkspaces
      ? `bun pm ls --all lists workspace members (${WORKSPACE_FILTER_PROBE_MARKER})`
      : `bun pm ls --all missing workspace marker ${WORKSPACE_FILTER_PROBE_MARKER} (exit ${result.exitCode ?? "?"})`,
  };
}

export interface BunLinkAudit {
  ok: boolean;
  message: string;
  exitCode: number | null;
  helpCommand: "bun link -h";
}

/** Verify `bun link` CLI is available (local package symlinks for dev). */
export async function auditBunLinkHealth(projectRoot: string): Promise<BunLinkAudit> {
  const result = await spawnBun(["link", "-h"], {
    cwd: projectRoot,
    timeoutMs: 15_000,
    maxOutputBytes: 8_192,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const ok = result.exitCode === 0 && /bun link/i.test(output);
  return {
    ok,
    helpCommand: "bun link -h",
    exitCode: result.exitCode,
    message: ok ? "bun link CLI available" : `bun link -h failed (exit ${result.exitCode ?? "?"})`,
  };
}

/** Verify core `bun pm` subcommands (hash, bin, pkg get, pack --dry-run) succeed from project root. */
export async function auditBunPmCliHealth(projectRoot: string): Promise<BunPmCliAudit> {
  const hash = await spawnBun(["pm", "hash"], {
    cwd: projectRoot,
    timeoutMs: 15_000,
    maxOutputBytes: 4_096,
  });
  const bin = await spawnBun(["pm", "bin"], {
    cwd: projectRoot,
    timeoutMs: 15_000,
    maxOutputBytes: 4_096,
  });
  const pkgGet = await spawnBun(["pm", "pkg", "get", "name"], {
    cwd: projectRoot,
    timeoutMs: 15_000,
    maxOutputBytes: 4_096,
  });
  const packDryRun = await spawnBun(["pm", "pack", "--dry-run"], {
    cwd: projectRoot,
    timeoutMs: 30_000,
    maxOutputBytes: 8_192,
  });
  const hashOk = hash.exitCode === 0 && Boolean(hash.stdout?.trim());
  const binOk = bin.exitCode === 0 && Boolean(bin.stdout?.includes("node_modules"));
  const pkgOk = pkgGet.exitCode === 0 && Boolean(pkgGet.stdout?.includes("kimi-toolchain"));
  const packOk = packDryRun.exitCode === 0;
  const ok = hashOk && binOk && pkgOk && packOk;
  return {
    ok,
    hashCommand: BUN_INSTALL_CLI.pmHash,
    binCommand: BUN_INSTALL_CLI.pmBin,
    pkgGetCommand: BUN_INSTALL_CLI.pmPkgGet,
    packDryRunCommand: BUN_INSTALL_CLI.pmPackDryRun,
    exitCode: ok ? 0 : (packDryRun.exitCode ?? pkgGet.exitCode ?? hash.exitCode ?? bin.exitCode),
    message: ok
      ? "bun pm hash, bin, pkg get name, and pack --dry-run succeeded"
      : `bun pm probe failed (hash=${hash.exitCode ?? "?"}, bin=${bin.exitCode ?? "?"}, pkg=${pkgGet.exitCode ?? "?"}, pack=${packDryRun.exitCode ?? "?"})`,
  };
}

/** Run `bun publish --dry-run` as a release pre-flight gate. */
export async function auditBunPublishDryRun(projectRoot: string): Promise<BunPublishDryRunAudit> {
  const result = await spawnBun(["publish", "--dry-run"], {
    cwd: projectRoot,
    timeoutMs: 60_000,
    maxOutputBytes: 512_000,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const authOnly = isPublishAuthOnlyFailure(output, result.exitCode);
  const privatePackage = isPublishPrivatePackageFailure(output);
  const ok = (result.exitCode === 0 && !result.isError) || authOnly || privatePackage;
  return {
    ok,
    command: BUN_PUBLISH_DRY_RUN_COMMAND,
    exitCode: result.exitCode,
    message: ok
      ? privatePackage
        ? "bun publish --dry-run skipped (private package; tarball pre-flight not required)"
        : authOnly
          ? "bun publish --dry-run packed tarball (registry auth deferred to release)"
          : "bun publish --dry-run exited 0"
      : `bun publish --dry-run failed (exit ${result.exitCode ?? "?"})${result.stderr ? `: ${result.stderr.trim().slice(0, 200)}` : ""}`,
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
    { field: "apiReferenceUrl", pathname: "/reference/bun" },
    { field: "docsRssUrl", pathname: "/rss.xml" },
  ];

  for (const { field, pathname } of apiDocFields) {
    const url = caps.runtimeApiDocs[field];
    if (typeof url !== "string") continue;
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

  checks.push(...buildPublishRegistryChecks(packageMeta));

  const workspaceFilter = await auditWorkspaceFilterHealth(projectRoot);
  checks.push({
    name: "workspace-filter:pm-ls-all",
    status: workspaceFilter.ok ? "ok" : "error",
    message: workspaceFilter.message,
    fixable: !workspaceFilter.ok,
  });
  if (!workspaceFilter.ok) {
    fixPlan.push(`verify workspaces: ${BUN_INSTALL_CLI.pmListAll}`);
  }

  const bunPm = await auditBunPmCliHealth(projectRoot);
  checks.push({
    name: "bun-pm:hash-bin-pkg",
    status: bunPm.ok ? "ok" : "error",
    message: bunPm.message,
    fixable: !bunPm.ok,
  });
  if (!bunPm.ok) {
    fixPlan.push(
      `repair bun pm: ${BUN_INSTALL_CLI.pmHash} && ${BUN_INSTALL_CLI.pmBin} && ${BUN_INSTALL_CLI.pmPkgGet} && ${BUN_INSTALL_CLI.pmPackDryRun}`
    );
    fixPlan.push(`if trust issues: ${BUN_INSTALL_CLI.pmTrustAll} for bulk lifecycle approval`);
  }

  const bunLink = await auditBunLinkHealth(projectRoot);
  checks.push({
    name: "bun-link:help",
    status: bunLink.ok ? "ok" : "error",
    message: bunLink.message,
    fixable: !bunLink.ok,
  });
  if (!bunLink.ok) {
    fixPlan.push(`repair bun link: ${BUN_INSTALL_CLI.linkRegister} -h`);
  }

  const publishDryRun = await auditBunPublishDryRun(projectRoot);
  checks.push({
    name: "publish:dry-run",
    status: publishDryRun.ok ? "ok" : "error",
    message: publishDryRun.message,
    fixable: !publishDryRun.ok,
  });
  if (!publishDryRun.ok) {
    fixPlan.push(`fix publish tarball: ${BUN_PUBLISH_DRY_RUN_COMMAND}`);
  }

  const aligned = checks.every((check) => check.status !== "error");
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

  if (suffix === "publish-dry-run") {
    const dryRun = report.checks.find((check) => check.name === "publish:dry-run");
    if (dryRun?.status === "ok") {
      return { ok: true, message: dryRun.message };
    }
    return {
      ok: false,
      message: dryRun?.message ?? `run ${BUN_PUBLISH_DRY_RUN_COMMAND} from repo root`,
    };
  }

  if (suffix === "bunPublish") {
    const cap = report.checks.find((check) => check.name === "capability:bunPublish");
    if (cap?.status === "ok") {
      return { ok: true, message: "bunPublish capability active in runtime inventory" };
    }
    return {
      ok: false,
      message: cap?.message ?? "bunPublish missing from buildRuntimeCapabilities()",
    };
  }

  if (suffix === "workspace-filter") {
    const cap = report.checks.find((check) => check.name === "capability:workspaceFilter");
    const probe = report.checks.find((check) => check.name === "workspace-filter:pm-ls-all");
    if (cap?.status === "ok" && probe?.status === "ok") {
      return { ok: true, message: probe.message };
    }
    return {
      ok: false,
      message: probe?.message ?? cap?.message ?? `run ${BUN_INSTALL_CLI.pmListAll}`,
    };
  }

  if (suffix === "bun-pm") {
    const cap = report.checks.find((check) => check.name === "capability:bunPmCli");
    const probe = report.checks.find((check) => check.name === "bun-pm:hash-bin-pkg");
    if (cap?.status === "ok" && probe?.status === "ok") {
      return { ok: true, message: probe.message };
    }
    return {
      ok: false,
      message: probe?.message ?? cap?.message ?? `run ${BUN_INSTALL_CLI.pmHash}`,
    };
  }

  if (suffix === "workspace-catalogs") {
    const cap = report.checks.find((check) => check.name === "capability:workspaceCatalogs");
    if (cap?.status === "ok") {
      return {
        ok: true,
        message: `workspaceCatalogs capability documented (catalog: protocol; ${BUN_CATALOGS_OVERVIEW_DOC_URL})`,
      };
    }
    return {
      ok: false,
      message: cap?.message ?? "workspaceCatalogs missing from buildRuntimeCapabilities()",
    };
  }

  if (suffix === "bun-link") {
    const cap = report.checks.find((check) => check.name === "capability:bunLink");
    const probe = report.checks.find((check) => check.name === "bun-link:help");
    if (cap?.status === "ok" && probe?.status === "ok") {
      return { ok: true, message: probe.message };
    }
    return {
      ok: false,
      message: probe?.message ?? cap?.message ?? `run ${BUN_INSTALL_CLI.linkRegister} -h`,
    };
  }

  const prefix =
    suffix === "runtime-api-docs"
      ? "runtime-api-docs:"
      : suffix === "bun-image"
        ? "bun-image:"
        : "capability:";
  const relevant = report.checks.filter((check) => check.name.startsWith(prefix));
  const failed = relevant.filter((check) => check.status === "error");

  if (failed.length === 0) {
    if (suffix === "runtime-api-docs") {
      return {
        ok: true,
        message: "runtimeApiDocs URLs aligned (runtime indexes, reference/bun, docs rss)",
      };
    }
    if (suffix === "bun-image") {
      return {
        ok: true,
        message: "Bun.Image supported with metadata probe and docs URL aligned",
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
