import { join } from "path";
import { describe, expect, test } from "bun:test";
import {
  auditCliAlignment,
  BUN_UPSTREAM_CLI_COVERAGE_RULES,
  BUN_UPSTREAM_CLI_TEST_FILE_COUNT,
  BUN_UPSTREAM_CLI_TEST_FILES,
  buildCliAlignmentRows,
  resolveCliTestCoverage,
} from "../src/lib/bun-upstream-cli-alignment.ts";
import {
  auditCliCaseAlignment,
  BUN_UPSTREAM_CLI_CASE_COUNT,
  BUN_UPSTREAM_CLI_PORT_REFS,
  buildCliPortRefRows,
} from "../src/lib/bun-upstream-cli-case-alignment.ts";
import { runAllCliContractProbes } from "../src/lib/bun-cli-contract-probes.ts";
import { BUN_UPSTREAM_TEST_COMMIT } from "../src/lib/bun-upstream-test-refs.ts";
import { REPO_ROOT } from "./helpers.ts";

describe("bun-upstream-cli-alignment", () => {
  test("frozen manifest pins 152 upstream test/cli files", () => {
    expect(BUN_UPSTREAM_CLI_TEST_FILE_COUNT).toBe(152);
    expect(BUN_UPSTREAM_CLI_TEST_FILES[0]).toBe("test/cli/bun.test.ts");
    expect(BUN_UPSTREAM_CLI_TEST_FILES).toContain("test/cli/console-depth.test.ts");
    expect(BUN_UPSTREAM_CLI_TEST_FILES).toContain("test/cli/install/bun-pm.test.ts");
  });

  test("coverage rules resolve every manifest path", () => {
    const report = auditCliAlignment();
    expect(report.commit).toBe(BUN_UPSTREAM_TEST_COMMIT);
    expect(report.total).toBe(152);
    expect(report.covered).toBe(152);
    expect(report.uncovered).toEqual([]);
    expect(report.percent).toBe(100);
    expect(report.aligned).toBe(true);
  });

  test("twenty upstream files are ported with runtime probes", () => {
    expect(BUN_UPSTREAM_CLI_PORT_REFS.length).toBe(20);

    for (const path of [
      "test/cli/console-depth.test.ts",
      "test/cli/user-agent.test.ts",
      "test/cli/bun.test.ts",
      "test/cli/bunfig-test-options.test.ts",
      "test/cli/heap-prof.test.ts",
      "test/cli/env/bun-options.test.ts",
      "test/cli/run/if-present.test.ts",
      "test/cli/test/pass-with-no-tests.test.ts",
      "test/cli/run/no-envfile.test.ts",
      "test/cli/run/filter-workspace.test.ts",
      "test/cli/init/init.test.ts",
      "test/cli/run/log-test.test.ts",
      "test/cli/test/bun-test.test.ts",
      "test/cli/test/test-changed.test.ts",
      "test/cli/run/env.test.ts",
      "test/cli/run/workspaces.test.ts",
      "test/cli/run/markdown-entrypoint.test.ts",
    ]) {
      expect(resolveCliTestCoverage(path)?.kind).toBe("ported");
    }
  });

  test("case catalog covers all 1863 upstream labels", () => {
    expect(BUN_UPSTREAM_CLI_CASE_COUNT).toBe(1863);
    const report = auditCliCaseAlignment();
    expect(report.cataloguedPercent).toBe(100);
    expect(report.aligned).toBe(true);
    expect(report.uncovered).toEqual([]);
    expect(report.portRefs).toBe(20);
    expect(report.probeIds).toBe(152);
  });

  test("port ref probe ids match runAllCliContractProbes", async () => {
    const expected = new Set(BUN_UPSTREAM_CLI_PORT_REFS.flatMap((r) => r.kimiProbes));
    const actual = (await runAllCliContractProbes()).map((p) => p.id);
    expect(actual.length).toBe(expected.size);
    for (const id of expected) {
      expect(actual).toContain(id);
    }
  }, 120_000);

  test("buildCliPortRefRows lists ported files", () => {
    const rows = buildCliPortRefRows();
    expect(rows).toHaveLength(20);
    expect(rows.some((r) => r.id === "cli.heap-prof" && r.cases === 7)).toBe(true);
  });

  test("install and inspect sections use expected coverage kinds", () => {
    expect(resolveCliTestCoverage("test/cli/run/env.test.ts")?.kind).toBe("ported");
    expect(resolveCliTestCoverage("test/cli/install/bun-install.test.ts")?.kind).toBe("inventory");
    expect(resolveCliTestCoverage("test/cli/inspect/inspect.test.ts")?.kind).toBe("harness");
    expect(resolveCliTestCoverage("test/cli/run/run-eval.test.ts")?.kind).toBe("ported");
  });

  test("every coverage rule kimiTest exists on disk", async () => {
    const tests = new Set(BUN_UPSTREAM_CLI_COVERAGE_RULES.map((r) => r.kimiTest));
    for (const rel of tests) {
      expect(await Bun.file(join(REPO_ROOT, rel)).exists()).toBe(true);
    }
  });

  test("buildCliAlignmentRows covers all sections", () => {
    const rows = buildCliAlignmentRows();
    const fileSum = rows.reduce((sum, row) => sum + row.files, 0);
    expect(fileSum).toBe(152);
    expect(rows.some((r) => r.section === "install" && r.kind === "inventory")).toBe(true);
    expect(rows.some((r) => r.section === "inspect" && r.kind === "harness")).toBe(true);
  });
});
