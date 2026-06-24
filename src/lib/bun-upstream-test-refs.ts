/**
 * oven-sh/bun test tree references — maps kimi contract ports to upstream sources.
 *
 * @see https://github.com/oven-sh/bun/tree/1bd44dbe60ff766faadb41e71a8ca67de4c72a6f/test
 */

export const BUN_UPSTREAM_TEST_COMMIT = "1bd44dbe60ff766faadb41e71a8ca67de4c72a6f";

export const BUN_UPSTREAM_TEST_TREE_URL = `https://github.com/oven-sh/bun/tree/${BUN_UPSTREAM_TEST_COMMIT}/test`;

/** CLI integration tests — harness spawns via {@link BUN_UPSTREAM_HARNESS_PATH}. */
export const BUN_UPSTREAM_TEST_CLI_TREE_URL = `https://github.com/oven-sh/bun/tree/${BUN_UPSTREAM_TEST_COMMIT}/test/cli`;

export const BUN_UPSTREAM_HARNESS_PATH = "test/harness.ts";

export interface BunUpstreamCliSection {
  readonly name: string;
  readonly path: string;
  readonly kind: "dir" | "file";
  readonly notes?: string;
}

/** Top-level `test/cli` entries @ pinned commit (not exhaustive subtree). */
export const BUN_UPSTREAM_CLI_SECTIONS = [
  { name: "run", path: "test/cli/run", kind: "dir", notes: "bun run, eval, shell, workspaces" },
  {
    name: "install",
    path: "test/cli/install",
    kind: "dir",
    notes: "bun install, lockfile, linker",
  },
  { name: "test", path: "test/cli/test", kind: "dir", notes: "bun test runner CLI" },
  {
    name: "inspect",
    path: "test/cli/inspect",
    kind: "dir",
    notes: "Chrome DevTools inspector protocol (not Bun.inspect.table)",
  },
  { name: "create", path: "test/cli/create", kind: "dir", notes: "bun create templates" },
  { name: "env", path: "test/cli/env", kind: "dir", notes: "BUN_* options, build --compile" },
  { name: "init", path: "test/cli/init", kind: "dir", notes: "bun init" },
  { name: "watch", path: "test/cli/watch", kind: "dir", notes: "bun --watch" },
  { name: "hot", path: "test/cli/hot", kind: "dir", notes: "HMR" },
  {
    name: "bun.test.ts",
    path: "test/cli/bun.test.ts",
    kind: "file",
    notes: "NO_COLOR, revision, getcompletes",
  },
  {
    name: "console-depth.test.ts",
    path: "test/cli/console-depth.test.ts",
    kind: "file",
    notes: "--console-depth / bunfig [console].depth",
  },
  {
    name: "heap-prof.test.ts",
    path: "test/cli/heap-prof.test.ts",
    kind: "file",
    notes: "heap profiling summary tables",
  },
  {
    name: "user-agent.test.ts",
    path: "test/cli/user-agent.test.ts",
    kind: "file",
    notes: "fetch user-agent",
  },
  {
    name: "bunfig-test-options.test.ts",
    path: "test/cli/bunfig-test-options.test.ts",
    kind: "file",
    notes: "bunfig test runner options",
  },
  {
    name: "update_interactive_formatting.test.ts",
    path: "test/cli/update_interactive_formatting.test.ts",
    kind: "file",
    notes: "bun update --interactive TUI formatting",
  },
  {
    name: "update_interactive_install.test.ts",
    path: "test/cli/update_interactive_install.test.ts",
    kind: "file",
    notes: "bun update --interactive install flow",
  },
  {
    name: "update_interactive_snapshots.test.ts",
    path: "test/cli/update_interactive_snapshots.test.ts",
    kind: "file",
    notes: "bun update --interactive snapshot matrix",
  },
] as const satisfies readonly BunUpstreamCliSection[];

export {
  auditCliAlignment,
  BUN_UPSTREAM_CLI_COVERAGE_RULES,
  BUN_UPSTREAM_CLI_TEST_FILE_COUNT,
  BUN_UPSTREAM_CLI_TEST_FILES,
  buildCliAlignmentRows,
  resolveCliTestCoverage,
  type CliAlignmentReport,
  type CliCoverageKind,
  type CliCoverageRule,
  type CliTestCoverage,
} from "./bun-upstream-cli-alignment.ts";

export {
  auditCliCaseAlignment,
  BUN_UPSTREAM_CLI_CASE_COUNT,
  BUN_UPSTREAM_CLI_CASES,
  BUN_UPSTREAM_CLI_PORT_REFS,
  buildCliPortRefRows,
  portedCliUpstreamPaths,
  resolveCliCase,
  type CliCaseAlignmentReport,
  type CliCaseResolution,
  type CliPortRef,
} from "./bun-upstream-cli-case-alignment.ts";

export interface BunUpstreamTestRef {
  /** Stable kimi id (matches verify probe / test basename where possible). */
  id: string;
  /** Path under oven-sh/bun repo root at {@link BUN_UPSTREAM_TEST_COMMIT}. */
  upstreamPath: string;
  /** Named upstream cases (`it`/`test`/`describe` labels). */
  upstreamCases: readonly string[];
  /** kimi implementation module (probe/lib). */
  kimiModule: string;
  /** kimi test file. */
  kimiTest: string;
  /** Optional fixture path(s) in kimi-toolchain. */
  kimiFixtures?: readonly string[];
  notes?: string;
}

/** Curated ports — Current + History, not the full upstream tree. */
export const BUN_UPSTREAM_TEST_REFS = [
  {
    id: "web.globals",
    upstreamPath: "test/js/bun/globals.test.js",
    upstreamCases: [
      "ERR_INVALID_THIS",
      "extendable",
      "writable",
      "name",
      "File",
      "globals are deletable",
      "self is a getter",
      "errors thrown by native code should be TypeError",
      "globalThis.gc",
    ],
    kimiModule: "src/lib/bun-web-globals-contract.ts",
    kimiTest: "test/bun-web-globals-contract.unit.test.ts",
    kimiFixtures: ["test/fixtures/deletable-globals.ts"],
    notes: "Upstream fixture: test/js/bun/deletable-globals-fixture.js",
  },
  {
    id: "inspect.table",
    upstreamPath: "test/js/bun/console/bun-inspect-table.test.ts",
    upstreamCases: ["inspect.table", "inspect.table (ansi)", "inspect.table (with properties)"],
    kimiModule: "src/lib/bun-release-inspect.ts",
    kimiTest: "test/bun-release-inspect.unit.test.ts",
    notes:
      "TablePrinter depth:0 parity; release registry rows not upstream data. Validate in oven-sh/bun with `bun bd test test/js/bun/console/bun-inspect-table.test.ts` (not `bun test`).",
  },
  {
    id: "console.table",
    upstreamPath: "test/js/bun/console/console-table.test.ts",
    upstreamCases: [
      "console.table",
      "console.table (ansi)",
      "console.table json fixture",
      "console.table repeat 50",
    ],
    kimiModule: "src/lib/bun-release-inspect.ts",
    kimiTest: "test/bun-release-inspect.unit.test.ts",
    kimiFixtures: ["test/fixtures/console-table-json-fixture.json"],
    notes:
      "renderReleaseTable mirrors shared TablePrinter + vendored JSON fixture. Validate in oven-sh/bun with `bun bd test test/js/bun/console/console-table.test.ts`.",
  },
  {
    id: "release.registry",
    upstreamPath: "test/README.md",
    upstreamCases: ["harness.ts", "test/js/bun", "test/js/web"],
    kimiModule: "src/lib/bun-release-registry.ts",
    kimiTest: "test/bun-utils.unit.test.ts",
    notes: "kimi SSOT for pinned releases; not a direct upstream port",
  },
  {
    id: "binary.portability",
    upstreamPath: "test/harness.ts",
    upstreamCases: ["glibc > 2.17 objdump", "libatomic ldd", "PE import allowlist"],
    kimiModule: "src/lib/bun-binary-portability.ts",
    kimiTest: "test/bun-binary-portability.unit.test.ts",
    notes: "Linker probes from bun CI; paths not under test/ at pinned commit",
  },
] as const satisfies readonly BunUpstreamTestRef[];

export type BunUpstreamTestRefId = (typeof BUN_UPSTREAM_TEST_REFS)[number]["id"];

/** GitHub blob URL for an upstream file at the pinned commit. */
export function upstreamBlobUrl(repoRelativePath: string): string {
  return `https://github.com/oven-sh/bun/blob/${BUN_UPSTREAM_TEST_COMMIT}/${repoRelativePath}`;
}

/** Rows for `test/cli` section index tables. */
export function buildUpstreamCliSectionRows(): Array<{
  name: string;
  kind: string;
  path: string;
  treeUrl: string;
  notes: string;
}> {
  return BUN_UPSTREAM_CLI_SECTIONS.map((section) => ({
    name: section.name,
    kind: section.kind,
    path: section.path,
    treeUrl: upstreamTreeUrl(section.path),
    notes: section.notes ?? "",
  }));
}

/** GitHub tree URL for a path under oven-sh/bun @ pinned commit. */
export function upstreamTreeUrl(repoRelativePath: string): string {
  return `https://github.com/oven-sh/bun/tree/${BUN_UPSTREAM_TEST_COMMIT}/${repoRelativePath}`;
}

/** Rows for Bun.inspect.table / release inspect tooling. */
export function buildUpstreamTestRefRows(): Array<{
  id: string;
  upstreamPath: string;
  cases: number;
  kimiTest: string;
  blobUrl: string;
}> {
  return BUN_UPSTREAM_TEST_REFS.map((ref) => ({
    id: ref.id,
    upstreamPath: ref.upstreamPath,
    cases: ref.upstreamCases.length,
    kimiTest: ref.kimiTest,
    blobUrl: upstreamBlobUrl(ref.upstreamPath),
  }));
}
