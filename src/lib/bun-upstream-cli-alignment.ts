/**
 * oven-sh/bun `test/cli` alignment — frozen manifest + coverage rules @ pinned commit.
 *
 * @see https://github.com/oven-sh/bun/tree/1bd44dbe60ff766faadb41e71a8ca67de4c72a6f/test/cli
 */

import manifest from "./bun-upstream-cli-manifest.json";
import { BUN_UPSTREAM_TEST_COMMIT } from "./bun-upstream-test-refs.ts";

/** Frozen upstream `test/cli` `*.test.{ts,js}` paths @ {@link BUN_UPSTREAM_TEST_COMMIT}. */
export const BUN_UPSTREAM_CLI_TEST_FILES = manifest as readonly string[];

export const BUN_UPSTREAM_CLI_TEST_FILE_COUNT = BUN_UPSTREAM_CLI_TEST_FILES.length;

export type CliCoverageKind = "ported" | "inventory" | "contract" | "harness";

export interface CliCoverageRule {
  /** Exact path, directory prefix (`test/cli/install/`), or filename prefix (`test/cli/update_interactive_`). */
  readonly match: string;
  readonly kind: CliCoverageKind;
  readonly kimiModule?: string;
  readonly kimiTest: string;
  readonly notes?: string;
}

/**
 * Coverage rules — every manifest path must resolve to exactly one rule.
 * Order: exact path → longest prefix → first match.
 */
export const BUN_UPSTREAM_CLI_COVERAGE_RULES = [
  {
    match: "test/cli/console-depth.test.ts",
    kind: "ported",
    kimiModule: "src/lib/bun-cli-contract-probes.ts",
    kimiTest: "test/bun-cli-console-depth.unit.test.ts",
    notes: "console depth flag + bunfig [console].depth",
  },
  {
    match: "test/cli/user-agent.test.ts",
    kind: "ported",
    kimiModule: "src/lib/bun-cli-contract-probes.ts",
    kimiTest: "test/bun-cli-user-agent.unit.test.ts",
    notes: "--user-agent fetch header",
  },
  {
    match: "test/cli/bun.test.ts",
    kind: "ported",
    kimiModule: "src/lib/bun-cli-contract-probes.ts",
    kimiTest: "test/bun-cli-bun.unit.test.ts",
    notes: "NO_COLOR, revision, getcompletes, --config",
  },
  {
    match: "test/cli/bunfig-test-options.test.ts",
    kind: "ported",
    kimiModule: "src/lib/bun-cli-contract-probes.ts",
    kimiTest: "test/bun-cli-bunfig-test-options.unit.test.ts",
    notes: "bunfig [test] randomize/seed/rerunEach",
  },
  {
    match: "test/cli/heap-prof.test.ts",
    kind: "ported",
    kimiModule: "src/lib/bun-cli-contract-probes.ts",
    kimiTest: "test/bun-cli-heap-prof.unit.test.ts",
    notes: "--heap-prof / --heap-prof-md output",
  },
  {
    match: "test/cli/env/bun-options.test.ts",
    kind: "ported",
    kimiModule: "src/lib/bun-cli-contract-probes.ts",
    kimiTest: "test/bun-cli-bun-options.unit.test.ts",
    notes: "BUN_OPTIONS env injection",
  },
  {
    match: "test/cli/update_interactive_",
    kind: "inventory",
    kimiModule: "src/lib/bun-install-config.ts",
    kimiTest: "test/bun-install-config.unit.test.ts",
    notes: "bun update --interactive inventory",
  },
  {
    match: "test/cli/install/",
    kind: "inventory",
    kimiModule: "src/lib/bun-install-config.ts",
    kimiTest: "test/bun-install-config.unit.test.ts",
    notes: "PM/install SSOT + probe:bun-install:* handoff",
  },
  {
    match: "test/cli/run/no-envfile.test.ts",
    kind: "ported",
    kimiModule: "src/lib/bun-cli-run-test-probes.ts",
    kimiTest: "test/bun-cli-run-test.unit.test.ts",
    notes: "--no-env-file and bunfig [env] toggles",
  },
  {
    match: "test/cli/run/log-test.test.ts",
    kind: "ported",
    kimiModule: "src/lib/bun-cli-run-test-probes.ts",
    kimiTest: "test/bun-cli-run-test.unit.test.ts",
    notes: "bunfig logLevel suppresses .env load logs",
  },
  {
    match: "test/cli/run/env.test.ts",
    kind: "ported",
    kimiModule: "src/lib/bun-cli-env-probes.ts",
    kimiTest: "test/bun-cli-env.unit.test.ts",
    notes: "dotenv loading + --env-file subset",
  },
  {
    match: "test/cli/run/workspaces.test.ts",
    kind: "ported",
    kimiModule: "src/lib/bun-cli-run-test-probes.ts",
    kimiTest: "test/bun-cli-run-test.unit.test.ts",
    notes: "bun run --workspaces script fan-out",
  },
  {
    match: "test/cli/run/markdown-entrypoint.test.ts",
    kind: "ported",
    kimiModule: "src/lib/bun-cli-markdown-probes.ts",
    kimiTest: "test/bun-cli-markdown.unit.test.ts",
    notes: "bun <file.md> markdown entrypoint subset",
  },
  {
    match: "test/cli/run/filter-workspace.test.ts",
    kind: "ported",
    kimiModule: "src/lib/bun-cli-run-test-probes.ts",
    kimiTest: "test/bun-cli-run-test.unit.test.ts",
    notes: "bun run --filter workspace subset",
  },
  {
    match: "test/cli/init/init.test.ts",
    kind: "ported",
    kimiModule: "src/lib/bun-cli-run-test-probes.ts",
    kimiTest: "test/bun-cli-run-test.unit.test.ts",
    notes: "bun init -y / --minimal / no-overwrite",
  },
  {
    match: "test/cli/run/if-present.test.ts",
    kind: "ported",
    kimiModule: "src/lib/bun-cli-run-test-probes.ts",
    kimiTest: "test/bun-cli-run-test.unit.test.ts",
    notes: "--if-present missing script/module/file",
  },
  {
    match: "test/cli/run/run-eval.test.ts",
    kind: "ported",
    kimiModule: "src/lib/bun-cli-run-test-probes.ts",
    kimiTest: "test/bun-cli-run-test.unit.test.ts",
    notes: "bun -e / --print / -p subset",
  },
  {
    match: "test/cli/run/empty-file.test.ts",
    kind: "ported",
    kimiModule: "src/lib/bun-cli-run-test-probes.ts",
    kimiTest: "test/bun-cli-run-test.unit.test.ts",
    notes: "empty script executes",
  },
  {
    match: "test/cli/test/pass-with-no-tests.test.ts",
    kind: "ported",
    kimiModule: "src/lib/bun-cli-run-test-probes.ts",
    kimiTest: "test/bun-cli-run-test.unit.test.ts",
    notes: "--pass-with-no-tests exit codes",
  },
  {
    match: "test/cli/test/bun-test.test.ts",
    kind: "ported",
    kimiModule: "src/lib/bun-cli-bun-test-probes.ts",
    kimiTest: "test/bun-cli-bun-test.unit.test.ts",
    notes: "bun test CLI flags subset (--bail, --timeout, --todo, only)",
  },
  {
    match: "test/cli/test/test-changed.test.ts",
    kind: "ported",
    kimiModule: "src/lib/bun-cli-test-changed-probes.ts",
    kimiTest: "test/bun-cli-test-changed.unit.test.ts",
    notes: "bun test --changed git import-graph subset",
  },
  {
    match: "test/cli/env/ci-info.test.ts",
    kind: "ported",
    kimiModule: "src/lib/bun-cli-run-test-probes.ts",
    kimiTest: "test/bun-cli-run-test.unit.test.ts",
    notes: "CI detection + test.only guard",
  },
  {
    match: "test/cli/run/",
    kind: "contract",
    kimiTest: "test/bun-cli-tooling.unit.test.ts",
    notes: "bun run / eval / shell / workspace CLI regressions",
  },
  {
    match: "test/cli/test/",
    kind: "inventory",
    kimiModule: "src/lib/test-gates.ts",
    kimiTest: "test/test-runtime.unit.test.ts",
    notes: "bun test runner tier + timeout contracts",
  },
  {
    match: "test/cli/inspect/",
    kind: "harness",
    kimiTest: "test/bun-upstream-cli-alignment.unit.test.ts",
    notes: "Chrome DevTools inspector — upstream harness only (bun bd test)",
  },
  {
    match: "test/cli/create/",
    kind: "contract",
    kimiTest: "test/smoke/bun-create.smoke.test.ts",
    notes: "bun create template smoke",
  },
  {
    match: "test/cli/env/",
    kind: "contract",
    kimiModule: "src/lib/bun-spawn-env.ts",
    kimiTest: "test/bun-spawn-env.unit.test.ts",
    notes: "BUN_* env + spawn hygiene",
  },
  {
    match: "test/cli/init/",
    kind: "contract",
    kimiTest: "test/scaffold-modules.unit.test.ts",
    notes: "bun init scaffold policy",
  },
  {
    match: "test/cli/watch/",
    kind: "harness",
    kimiTest: "test/bun-upstream-cli-alignment.unit.test.ts",
    notes: "file watcher trace — upstream harness only",
  },
  {
    match: "test/cli/hot/",
    kind: "harness",
    kimiTest: "test/bun-upstream-cli-alignment.unit.test.ts",
    notes: "HMR — upstream harness only",
  },
] as const satisfies readonly CliCoverageRule[];

export interface CliTestCoverage {
  readonly upstreamPath: string;
  readonly kind: CliCoverageKind;
  readonly ruleMatch: string;
  readonly kimiModule?: string;
  readonly kimiTest: string;
  readonly notes?: string;
}

export interface CliAlignmentReport {
  readonly commit: string;
  readonly total: number;
  readonly covered: number;
  readonly uncovered: readonly string[];
  readonly percent: number;
  readonly aligned: boolean;
  readonly byKind: Readonly<Record<CliCoverageKind, number>>;
  readonly bySection: Readonly<Record<string, number>>;
}

function ruleSpecificity(match: string, path: string): number {
  if (match === path) return 10_000 + match.length;
  if (match.endsWith("/") && path.startsWith(match)) return 1_000 + match.length;
  if (!match.endsWith("/") && path.startsWith(match)) return 500 + match.length;
  return -1;
}

/** Resolve coverage for one upstream `test/cli` path. */
export function resolveCliTestCoverage(upstreamPath: string): CliTestCoverage | null {
  let best: (CliCoverageRule & { specificity: number }) | null = null;
  for (const rule of BUN_UPSTREAM_CLI_COVERAGE_RULES) {
    const specificity = ruleSpecificity(rule.match, upstreamPath);
    if (specificity < 0) continue;
    if (!best || specificity > best.specificity) {
      best = { ...rule, specificity };
    }
  }
  if (!best) return null;
  return {
    upstreamPath,
    kind: best.kind,
    ruleMatch: best.match,
    kimiModule: best.kimiModule,
    kimiTest: best.kimiTest,
    notes: best.notes,
  };
}

function cliSectionKey(path: string): string {
  const rest = path.slice("test/cli/".length);
  const slash = rest.indexOf("/");
  return slash === -1 ? rest : rest.slice(0, slash);
}

/** Audit frozen manifest coverage — `aligned` when `percent === 100`. */
export function auditCliAlignment(): CliAlignmentReport {
  const uncovered: string[] = [];
  const byKind: Record<CliCoverageKind, number> = {
    ported: 0,
    inventory: 0,
    contract: 0,
    harness: 0,
  };
  const bySection: Record<string, number> = {};

  for (const path of BUN_UPSTREAM_CLI_TEST_FILES) {
    const coverage = resolveCliTestCoverage(path);
    if (!coverage) {
      uncovered.push(path);
      continue;
    }
    byKind[coverage.kind] += 1;
    const section = cliSectionKey(path);
    bySection[section] = (bySection[section] ?? 0) + 1;
  }

  const total = BUN_UPSTREAM_CLI_TEST_FILES.length;
  const covered = total - uncovered.length;
  const percent = total > 0 ? Math.round((covered / total) * 1000) / 10 : 100;

  return {
    commit: BUN_UPSTREAM_TEST_COMMIT,
    total,
    covered,
    uncovered,
    percent,
    aligned: uncovered.length === 0,
    byKind,
    bySection,
  };
}

export function buildCliAlignmentRows(): Array<{
  section: string;
  files: number;
  kind: string;
  kimiTest: string;
}> {
  const sectionMeta = new Map<string, { files: number; kind: CliCoverageKind; kimiTest: string }>();
  for (const path of BUN_UPSTREAM_CLI_TEST_FILES) {
    const coverage = resolveCliTestCoverage(path);
    if (!coverage) continue;
    const section = cliSectionKey(path);
    const prev = sectionMeta.get(section);
    if (!prev) {
      sectionMeta.set(section, { files: 1, kind: coverage.kind, kimiTest: coverage.kimiTest });
      continue;
    }
    prev.files += 1;
  }
  return [...sectionMeta.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([section, meta]) => ({
      section,
      files: meta.files,
      kind: meta.kind,
      kimiTest: meta.kimiTest,
    }));
}
