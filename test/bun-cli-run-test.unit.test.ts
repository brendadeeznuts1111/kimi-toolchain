/**
 * Ported from oven-sh/bun test/cli/run, test/cli/test, test/cli/env @ pinned commit.
 */

import { describe, expect, test } from "bun:test";
import {
  runCiInfoContractProbes,
  runEmptyFileContractProbes,
  runEvalContractProbes,
  runIfPresentContractProbes,
  runPassWithNoTestsProbes,
  runFilterWorkspaceContractProbes,
  runInitContractProbes,
  runLogTestContractProbes,
  runNoEnvFileContractProbes,
  runRunTestContractProbes,
} from "../src/lib/bun-cli-run-test-probes.ts";

describe("bun-cli-run-test contract probes", () => {
  test("runRunTestContractProbes all pass on current Bun", async () => {
    const failed = (await runRunTestContractProbes()).filter((r) => !r.ok);
    expect(failed).toEqual([]);
  }, 60_000);

  test("if-present probes", async () => {
    expect((await runIfPresentContractProbes()).every((r) => r.ok)).toBe(true);
  });

  test("run-eval probes", async () => {
    expect((await runEvalContractProbes()).every((r) => r.ok)).toBe(true);
  });

  test("pass-with-no-tests probes", async () => {
    expect((await runPassWithNoTestsProbes()).every((r) => r.ok)).toBe(true);
  });

  test("ci-info probes", async () => {
    expect((await runCiInfoContractProbes()).every((r) => r.ok)).toBe(true);
  });

  test("empty-file probe", async () => {
    expect((await runEmptyFileContractProbes()).every((r) => r.ok)).toBe(true);
  });

  test("no-env-file probes", async () => {
    expect((await runNoEnvFileContractProbes()).every((r) => r.ok)).toBe(true);
  });

  test("filter-workspace probes", async () => {
    expect((await runFilterWorkspaceContractProbes()).every((r) => r.ok)).toBe(true);
  });

  test("log-test probes", async () => {
    expect((await runLogTestContractProbes()).every((r) => r.ok)).toBe(true);
  });

  test("init probes", async () => {
    expect((await runInitContractProbes()).every((r) => r.ok)).toBe(true);
  }, 60_000);
});
