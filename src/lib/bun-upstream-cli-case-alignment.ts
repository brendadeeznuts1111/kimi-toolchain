/**
 * Case-level depth for oven-sh/bun `test/cli` — 1863 upstream `test`/`it` labels @ pinned commit.
 *
 * @see https://github.com/oven-sh/bun/tree/1bd44dbe60ff766faadb41e71a8ca67de4c72a6f/test/cli
 */

import cases from "./bun-upstream-cli-cases.json";
import {
  auditCliAlignment,
  type CliCoverageKind,
  resolveCliTestCoverage,
} from "./bun-upstream-cli-alignment.ts";
import { BUN_UPSTREAM_TEST_COMMIT } from "./bun-upstream-test-refs.ts";

/** Upstream case labels keyed by `test/cli/...` path @ pinned commit. */
export const BUN_UPSTREAM_CLI_CASES = cases as Readonly<Record<string, readonly string[]>>;

export const BUN_UPSTREAM_CLI_CASE_COUNT = Object.values(BUN_UPSTREAM_CLI_CASES).reduce(
  (sum, labels) => sum + labels.length,
  0
);

export interface CliPortRef {
  readonly id: string;
  readonly upstreamPath: string;
  /** Top-level upstream `test`/`it` labels (excludes nested fixture labels). */
  readonly upstreamCases: readonly string[];
  readonly kimiModule: string;
  readonly kimiTest: string;
  /** Runtime probe ids from {@link runAllCliContractProbes}. */
  readonly kimiProbes: readonly string[];
  readonly notes?: string;
}

/** Runnable ports — upstream cases kimi executes via probes and/or unit tests. */
export const BUN_UPSTREAM_CLI_PORT_REFS = [
  {
    id: "cli.console-depth",
    upstreamPath: "test/cli/console-depth.test.ts",
    upstreamCases: [
      "default console depth should be 2",
      "--console-depth flag sets custom depth",
      "--console-depth with higher value shows deeper nesting",
      "bunfig.toml console.depth configuration",
      "CLI flag overrides bunfig.toml",
      "invalid --console-depth value shows error",
      "edge case: depth 0 should show infinite depth",
      "bunfig.toml depth=0 should show infinite depth",
      "console depth affects console.log, console.error, and console.warn",
    ],
    kimiModule: "src/lib/bun-cli-contract-probes.ts",
    kimiTest: "test/bun-cli-console-depth.unit.test.ts",
    kimiProbes: [
      "cli.console-depth.default",
      "cli.console-depth.flag",
      "cli.console-depth.flag-high",
      "cli.console-depth.bunfig",
      "cli.console-depth.override",
      "cli.console-depth.invalid",
      "cli.console-depth.zero",
      "cli.console-depth.bunfig-zero",
      "cli.console-depth.multi",
    ],
  },
  {
    id: "cli.user-agent",
    upstreamPath: "test/cli/user-agent.test.ts",
    upstreamCases: [
      "custom user agent is sent in HTTP requests",
      "default user agent is used when --user-agent is not specified",
    ],
    kimiModule: "src/lib/bun-cli-contract-probes.ts",
    kimiTest: "test/bun-cli-user-agent.unit.test.ts",
    kimiProbes: ["cli.user-agent.custom", "cli.user-agent.default"],
  },
  {
    id: "cli.bun",
    upstreamPath: "test/cli/bun.test.ts",
    upstreamCases: [
      "respects NO_COLOR=${JSON.stringify(value)} to disable color",
      "revision generates version numbers correctly",
      "getcompletes should not panic and should not be empty",
      "getcompletes keeps scripts whose names start with ",
      "test --config, issue #4128",
    ],
    kimiModule: "src/lib/bun-cli-contract-probes.ts",
    kimiTest: "test/bun-cli-bun.unit.test.ts",
    kimiProbes: [
      "cli.bun.no-color",
      "cli.bun.revision",
      "cli.bun.getcompletes",
      "cli.bun.getcompletes-pre-post",
      "cli.bun.config",
    ],
    notes: "Upstream NO_COLOR enable-color cases are test.todo (TTY)",
  },
  {
    id: "cli.bunfig-test-options",
    upstreamPath: "test/cli/bunfig-test-options.test.ts",
    upstreamCases: [
      "randomize with seed produces consistent order",
      "seed without randomize errors",
      "seed with randomize=false errors",
      "rerunEach option works",
      "all test options together",
    ],
    kimiModule: "src/lib/bun-cli-contract-probes.ts",
    kimiTest: "test/bun-cli-bunfig-test-options.unit.test.ts",
    kimiProbes: [
      "cli.bunfig.randomize-seed",
      "cli.bunfig.seed-without-randomize",
      "cli.bunfig.seed-randomize-false",
      "cli.bunfig.rerun-each",
      "cli.bunfig.all-options",
    ],
  },
  {
    id: "cli.heap-prof",
    upstreamPath: "test/cli/heap-prof.test.ts",
    upstreamCases: [
      "--heap-prof generates V8 heap snapshot on exit",
      "--heap-prof-md generates markdown heap profile on exit",
      "--heap-prof-dir specifies output directory for V8 format",
      "--heap-prof-dir specifies output directory for markdown format",
      "--heap-prof-name specifies output filename",
      "--heap-prof-name and --heap-prof-dir work together",
      "--heap-prof-name without --heap-prof or --heap-prof-md shows warning",
    ],
    kimiModule: "src/lib/bun-cli-contract-probes.ts",
    kimiTest: "test/bun-cli-heap-prof.unit.test.ts",
    kimiProbes: [
      "cli.heap-prof.v8",
      "cli.heap-prof.md",
      "cli.heap-prof.dir-v8",
      "cli.heap-prof.dir-md",
      "cli.heap-prof.name",
      "cli.heap-prof.name-dir",
      "cli.heap-prof.name-warn",
    ],
  },
  {
    id: "cli.bun-options",
    upstreamPath: "test/cli/env/bun-options.test.ts",
    upstreamCases: [
      "basic usage - passes options to bun command",
      "multiple options - passes all options to bun command",
      "options with quotes - properly handles quoted options",
      "priority - environment options go before command line options",
      "bare flag before flag with value is recognized",
      "empty BUN_OPTIONS - should work normally",
    ],
    kimiModule: "src/lib/bun-cli-contract-probes.ts",
    kimiTest: "test/bun-cli-bun-options.unit.test.ts",
    kimiProbes: [
      "cli.bun-options.basic",
      "cli.bun-options.multiple",
      "cli.bun-options.quotes",
      "cli.bun-options.priority",
      "cli.bun-options.cpu-prof",
      "cli.bun-options.empty",
    ],
    notes: "Standalone compile case omitted (60s upstream harness)",
  },
  {
    id: "cli.run.if-present",
    upstreamPath: "test/cli/run/if-present.test.ts",
    upstreamCases: [
      "should error with missing script",
      "should error with missing module",
      "should error with missing file",
      "should not error with missing script",
      "should not error with missing module",
      "should not error with missing file",
      "should run present script",
      "should run present module",
    ],
    kimiModule: "src/lib/bun-cli-run-test-probes.ts",
    kimiTest: "test/bun-cli-run-test.unit.test.ts",
    kimiProbes: [
      "cli.run.if-present.error-script",
      "cli.run.if-present.error-module",
      "cli.run.if-present.error-file",
      "cli.run.if-present.ok-script",
      "cli.run.if-present.ok-module",
      "cli.run.if-present.ok-file",
      "cli.run.if-present.run-script",
      "cli.run.if-present.run-module",
    ],
  },
  {
    id: "cli.run.eval",
    upstreamPath: "test/cli/run/run-eval.test.ts",
    upstreamCases: ["it works", "process._eval", "→ ${expected}"],
    kimiModule: "src/lib/bun-cli-run-test-probes.ts",
    kimiTest: "test/bun-cli-run-test.unit.test.ts",
    kimiProbes: [
      "cli.run.eval.e",
      "cli.run.eval.print",
      "cli.run.eval.process-eval",
      "cli.run.eval.tla-print",
    ],
    notes: "Subset without react/jsx harness deps",
  },
  {
    id: "cli.test.pass-with-no-tests",
    upstreamPath: "test/cli/test/pass-with-no-tests.test.ts",
    upstreamCases: [
      "--pass-with-no-tests exits with 0 when no test files found",
      "--pass-with-no-tests exits with 0 when filters match no tests",
      "without --pass-with-no-tests, exits with 1 when no test files found",
      "without --pass-with-no-tests, exits with 1 when filters match no tests",
      "--pass-with-no-tests still fails when tests fail",
    ],
    kimiModule: "src/lib/bun-cli-run-test-probes.ts",
    kimiTest: "test/bun-cli-run-test.unit.test.ts",
    kimiProbes: [
      "cli.test.pass-no-tests.ok-empty",
      "cli.test.pass-no-tests.ok-filter",
      "cli.test.pass-no-tests.fail-empty",
      "cli.test.pass-no-tests.fail-filter",
      "cli.test.pass-no-tests.fail-on-test-fail",
    ],
  },
  {
    id: "cli.env.ci-info",
    upstreamPath: "test/cli/env/ci-info.test.ts",
    upstreamCases: [
      "Without CI env vars, test.only should work",
      "CI=false disables CI detection even with GITHUB_ACTIONS=true",
      "CI=true enables CI detection even with no CI env vars",
      "CI=true enables CI detection with GITHUB_ACTIONS=true",
    ],
    kimiModule: "src/lib/bun-cli-run-test-probes.ts",
    kimiTest: "test/bun-cli-run-test.unit.test.ts",
    kimiProbes: [
      "cli.env.ci-info.allow",
      "cli.env.ci-info.ci-false",
      "cli.env.ci-info.ci-true",
      "cli.env.ci-info.ci-true-github",
    ],
  },
  {
    id: "cli.run.empty-file",
    upstreamPath: "test/cli/run/empty-file.test.ts",
    upstreamCases: ["should execute empty scripts"],
    kimiModule: "src/lib/bun-cli-run-test-probes.ts",
    kimiTest: "test/bun-cli-run-test.unit.test.ts",
    kimiProbes: ["cli.run.empty-file"],
  },
  {
    id: "cli.run.no-envfile",
    upstreamPath: "test/cli/run/no-envfile.test.ts",
    upstreamCases: [
      "--no-env-file disables .env loading",
      "--no-env-file disables .env.local loading",
      "--no-env-file disables .env.development.local loading",
      "bunfig env.file = false disables .env loading",
      "bunfig env = false disables .env loading",
      "--no-env-file with -e flag",
      "--no-env-file combined with --env-file still loads explicit file",
      "bunfig env = true still loads .env files",
      "--no-env-file in production mode",
    ],
    kimiModule: "src/lib/bun-cli-run-test-probes.ts",
    kimiTest: "test/bun-cli-run-test.unit.test.ts",
    kimiProbes: [
      "cli.run.no-envfile.dotenv",
      "cli.run.no-envfile.local",
      "cli.run.no-envfile.dev-local",
      "cli.run.no-envfile.bunfig-file-false",
      "cli.run.no-envfile.bunfig-env-false",
      "cli.run.no-envfile.eval",
      "cli.run.no-envfile.explicit-env-file",
      "cli.run.no-envfile.bunfig-true",
      "cli.run.no-envfile.production",
    ],
  },
  {
    id: "cli.run.filter-workspace",
    upstreamPath: "test/cli/run/filter-workspace.test.ts",
    upstreamCases: [
      "resolve ${name} from ${d}",
      "resolve ",
      "resolve all with glob",
      "works with auto command",
      "resolve 'pkga' and 'pkgb' but not 'pkgc' with targeted glob",
      "should error with missing script",
      "should warn about malformed package.json",
      "nonzero exit code on failure",
      "warning names which package.json failed to parse",
      "respect dependency order",
      "run pre and post scripts, in order",
      "--elide-lines is a no-op (not an error) when stdout is not a terminal",
    ],
    kimiModule: "src/lib/bun-cli-run-test-probes.ts",
    kimiTest: "test/bun-cli-run-test.unit.test.ts",
    kimiProbes: [
      "cli.run.filter.pkga",
      "cli.run.filter.star",
      "cli.run.filter.missing-script",
      "cli.run.filter.broken-json",
      "cli.run.filter.scoped",
      "cli.run.filter.glob",
      "cli.run.filter.auto",
      "cli.run.filter.multi",
      "cli.run.filter.pkg-glob",
      "cli.run.filter.malformed-warn",
      "cli.run.filter.exit-fail",
      "cli.run.filter.subdir",
      "cli.run.filter.dep-order",
      "cli.run.filter.pre-post",
      "cli.run.filter.elide-noop",
    ],
    notes: "Workspace --filter expanded subset; parallel/cycle cases omitted",
  },
  {
    id: "cli.run.workspaces",
    upstreamPath: "test/cli/run/workspaces.test.ts",
    upstreamCases: [
      "bun run --workspaces runs script in all workspace packages",
      "bun run --workspaces --if-present succeeds when script is missing",
      "bun run --workspaces fails when no packages have the script",
    ],
    kimiModule: "src/lib/bun-cli-run-test-probes.ts",
    kimiTest: "test/bun-cli-run-test.unit.test.ts",
    kimiProbes: [
      "cli.run.workspaces.all",
      "cli.run.workspaces.if-present",
      "cli.run.workspaces.missing",
    ],
  },
  {
    id: "cli.run.env",
    upstreamPath: "test/cli/run/env.test.ts",
    upstreamCases: [
      ".env",
      ".env.local",
      ".env.development (NODE_ENV=development)",
      ".env.production",
      "process env overrides everything else",
      ".env colon assign",
      ".env export assign",
      ".env value expansion",
      "single arg",
      "multiple args",
      "NODE_ENV is automatically set to test within bun test",
      ".env comments",
      ".env escaped dollar sign",
      "priority on multi-file single arg",
      "priority on process env",
      "empty string disables default dotenv behavior",
      ".env.local overrides .env.{NODE_ENV}",
      ".env.{NODE_ENV}.local overrides .env.local",
      "basic case",
      "#3911",
      "buffer boundary",
      ".env space edgecase (issue #411)",
      ".env.{NODE_ENV} overrides .env",
      "when arg missing, fallback to default dotenv behavior",
      "only Bun.env",
      "only process.env",
      "only import.meta.env",
    ],
    kimiModule: "src/lib/bun-cli-env-probes.ts",
    kimiTest: "test/bun-cli-env.unit.test.ts",
    kimiProbes: [
      "cli.run.env.dotenv",
      "cli.run.env.local",
      "cli.run.env.development",
      "cli.run.env.production",
      "cli.run.env.process-override",
      "cli.run.env.colon",
      "cli.run.env.export",
      "cli.run.env.expand",
      "cli.run.env.env-file-single",
      "cli.run.env.env-file-multi",
      "cli.run.env.node-env-test",
      "cli.run.env.comments",
      "cli.run.env.escaped-dollar",
      "cli.run.env.env-file-priority",
      "cli.run.env.env-file-process",
      "cli.run.env.env-file-empty",
      "cli.run.env.local-overrides-env",
      "cli.run.env.dev-local-overrides",
      "cli.run.env.inlining",
      "cli.run.env.issue-3911",
      "cli.run.env.buffer-boundary",
      "cli.run.env.space-411",
      "cli.run.env.node-env-overrides",
      "cli.run.env.fallback-dotenv",
      "cli.run.env.bun-env",
      "cli.run.env.process-env",
      "cli.run.env.import-meta",
    ],
    notes: "Dotenv matrix subset; large-file/boundary cases omitted",
  },
  {
    id: "cli.init",
    upstreamPath: "test/cli/init/init.test.ts",
    upstreamCases: [
      "bun init works",
      "bun init --minimal only creates package.json and tsconfig.json",
      "bun init error rather than overwriting file",
    ],
    kimiModule: "src/lib/bun-cli-run-test-probes.ts",
    kimiTest: "test/bun-cli-run-test.unit.test.ts",
    kimiProbes: ["cli.init.works", "cli.init.minimal", "cli.init.no-overwrite"],
    notes: "React/twice/piped cases omitted (network/interactive)",
  },
  {
    id: "cli.run.log-test",
    upstreamPath: "test/cli/run/log-test.test.ts",
    upstreamCases: ["should not log .env when quiet", "should log .env by default"],
    kimiModule: "src/lib/bun-cli-run-test-probes.ts",
    kimiTest: "test/bun-cli-run-test.unit.test.ts",
    kimiProbes: ["cli.run.log-test.quiet", "cli.run.log-test.default"],
  },
  {
    id: "cli.test.bun-test",
    upstreamPath: "test/cli/test/bun-test.test.ts",
    upstreamCases: [
      "running a non-existent absolute file path is a 1 exit code",
      "must provide a number bail",
      "must provide non-negative bail",
      "should not be 0",
      "must provide a number timeout",
      "must provide non-negative timeout",
      "should not run todo by default",
      "should run todo when enabled",
      "should run nested describe.only",
      "bail should be 1 by default",
      "should bail out after 3 failures",
      "can provide no arguments",
      "if that filter is a path to a directory, will run all tests in that directory",
      "Prints error when no test matches",
      "works with require",
      "works with cjs require",
      "can provide a relative file",
      "should skip non-only tests",
    ],
    kimiModule: "src/lib/bun-cli-bun-test-probes.ts",
    kimiTest: "test/bun-cli-bun-test.unit.test.ts",
    kimiProbes: [
      "cli.test.bun-test.missing-path",
      "cli.test.bun-test.bail-foo",
      "cli.test.bun-test.bail-neg",
      "cli.test.bun-test.bail-zero",
      "cli.test.bun-test.timeout-foo",
      "cli.test.bun-test.timeout-neg",
      "cli.test.bun-test.todo-default",
      "cli.test.bun-test.todo-enabled",
      "cli.test.bun-test.only-nested",
      "cli.test.bun-test.bail-default",
      "cli.test.bun-test.bail-three",
      "cli.test.bun-test.no-args",
      "cli.test.bun-test.dir-filter",
      "cli.test.bun-test.no-match",
      "cli.test.bun-test.require",
      "cli.test.bun-test.cjs-require",
      "cli.test.bun-test.relative-file",
      "cli.test.bun-test.skip-only",
    ],
    notes: "Subset without .each / GHA / discovery matrix",
  },
  {
    id: "cli.test.changed",
    upstreamPath: "test/cli/test/test-changed.test.ts",
    upstreamCases: [
      "no changes -> runs nothing and exits 0",
      "direct change to a test file runs only that test",
      "change to a direct dependency selects the importing test",
      "change to a file no test imports runs nothing",
      "change to a transitive dependency selects the importing test",
      "multiple changes select the union of affected tests",
      "shared dependency selects all importers",
      "staged changes are picked up",
      "errors helpfully outside a git repo",
      "untracked test file is picked up",
      "--changed=<ref> compares against a commit",
      "--changed=<ref> includes untracked files",
      "change inside node_modules does not select any test",
      "works from a subdirectory of the git repo",
      "tsconfig paths alias is followed when computing the module graph",
      "test with a syntax-error dependency still filters by changed path",
      "untracked test file in a subdirectory is picked up",
    ],
    kimiModule: "src/lib/bun-cli-test-changed-probes.ts",
    kimiTest: "test/bun-cli-test-changed.unit.test.ts",
    kimiProbes: [
      "cli.test.changed.none",
      "cli.test.changed.direct",
      "cli.test.changed.dep",
      "cli.test.changed.unrelated",
      "cli.test.changed.nogit",
      "cli.test.changed.transitive",
      "cli.test.changed.staged",
      "cli.test.changed.shared",
      "cli.test.changed.multi",
      "cli.test.changed.untracked",
      "cli.test.changed.ref",
      "cli.test.changed.ref-untracked",
      "cli.test.changed.nm",
      "cli.test.changed.subdir",
      "cli.test.changed.tsconfig-paths",
      "cli.test.changed.parseerr",
      "cli.test.changed.subdir-untracked",
    ],
    notes: "Subset without --watch composition",
  },
  {
    id: "cli.run.markdown",
    upstreamPath: "test/cli/run/markdown-entrypoint.test.ts",
    upstreamCases: ["renders headings with underlines", "runs without colors when NO_COLOR is set"],
    kimiModule: "src/lib/bun-cli-markdown-probes.ts",
    kimiTest: "test/bun-cli-markdown.unit.test.ts",
    kimiProbes: ["cli.run.markdown.headings", "cli.run.markdown.no-color"],
    notes: "Snapshot-heavy cases omitted; plain render + NO_COLOR subset",
  },
] as const satisfies readonly CliPortRef[];

const PORTED_PATHS = new Set(BUN_UPSTREAM_CLI_PORT_REFS.map((r) => r.upstreamPath));

const DEPTH_WEIGHT: Record<CliCoverageKind, number> = {
  ported: 1,
  contract: 0.65,
  inventory: 0.45,
  harness: 0.25,
};

export interface CliCaseResolution {
  readonly upstreamPath: string;
  readonly caseLabel: string;
  readonly kind: CliCoverageKind;
  readonly depthWeight: number;
  readonly portId?: string;
}

export interface CliCaseAlignmentReport {
  readonly commit: string;
  readonly totalCases: number;
  readonly cataloguedCases: number;
  readonly cataloguedPercent: number;
  readonly portedCases: number;
  readonly portedPercent: number;
  readonly depthWeightedPercent: number;
  readonly aligned: boolean;
  readonly byKind: Readonly<Record<CliCoverageKind, number>>;
  readonly portRefs: number;
  readonly probeIds: number;
  readonly uncovered: readonly string[];
}

/** Resolve one upstream case label via its parent file coverage rule. */
export function resolveCliCase(path: string, caseLabel: string): CliCaseResolution | null {
  const coverage = resolveCliTestCoverage(path);
  if (!coverage) return null;
  const port = BUN_UPSTREAM_CLI_PORT_REFS.find((r) => r.upstreamPath === path);
  return {
    upstreamPath: path,
    caseLabel,
    kind: port ? "ported" : coverage.kind,
    depthWeight: port ? 1 : DEPTH_WEIGHT[coverage.kind],
    portId: port?.id,
  };
}

/** Case catalog + depth scoring — `aligned` when every case resolves and cataloguedPercent is 100. */
export function auditCliCaseAlignment(): CliCaseAlignmentReport {
  const fileReport = auditCliAlignment();
  const uncovered: string[] = [];
  const byKind: Record<CliCoverageKind, number> = {
    ported: 0,
    inventory: 0,
    contract: 0,
    harness: 0,
  };
  let depthWeighted = 0;

  for (const [path, labels] of Object.entries(BUN_UPSTREAM_CLI_CASES)) {
    for (const label of labels) {
      const resolution = resolveCliCase(path, label);
      if (!resolution) {
        uncovered.push(`${path} :: ${label}`);
        continue;
      }
      byKind[resolution.kind] += 1;
      depthWeighted += resolution.depthWeight;
    }
  }

  const totalCases = BUN_UPSTREAM_CLI_CASE_COUNT;
  const cataloguedCases = totalCases - uncovered.length;
  const cataloguedPercent =
    totalCases > 0 ? Math.round((cataloguedCases / totalCases) * 1000) / 10 : 100;
  const portedCases = byKind.ported;
  const portedPercent = totalCases > 0 ? Math.round((portedCases / totalCases) * 1000) / 10 : 100;
  const depthWeightedPercent =
    totalCases > 0 ? Math.round((depthWeighted / totalCases) * 1000) / 10 : 100;
  const probeIds = BUN_UPSTREAM_CLI_PORT_REFS.reduce((sum, r) => sum + r.kimiProbes.length, 0);

  return {
    commit: BUN_UPSTREAM_TEST_COMMIT,
    totalCases,
    cataloguedCases,
    cataloguedPercent,
    portedCases,
    portedPercent,
    depthWeightedPercent,
    aligned: uncovered.length === 0 && fileReport.aligned && cataloguedPercent === 100,
    byKind,
    portRefs: BUN_UPSTREAM_CLI_PORT_REFS.length,
    probeIds,
    uncovered,
  };
}

export function buildCliPortRefRows(): Array<{
  id: string;
  upstreamPath: string;
  cases: number;
  probes: number;
  kimiTest: string;
}> {
  return BUN_UPSTREAM_CLI_PORT_REFS.map((ref) => ({
    id: ref.id,
    upstreamPath: ref.upstreamPath,
    cases: ref.upstreamCases.length,
    probes: ref.kimiProbes.length,
    kimiTest: ref.kimiTest,
  }));
}

/** Paths kimi ports with runtime probes (subset of manifest). */
export function portedCliUpstreamPaths(): readonly string[] {
  return [...PORTED_PATHS];
}
