/**
 * Ported from oven-sh/bun test/cli/test/test-changed.test.ts @ pinned commit (subset).
 */

import { describe, expect, test } from "bun:test";
import { runTestChangedContractProbes } from "../src/lib/bun-cli-test-changed-probes.ts";

describe("bun-cli-test-changed contract probes", () => {
  test("runTestChangedContractProbes all pass on current Bun", async () => {
    const failed = (await runTestChangedContractProbes()).filter((r) => !r.ok);
    expect(failed).toEqual([]);
  }, 120_000);
});
