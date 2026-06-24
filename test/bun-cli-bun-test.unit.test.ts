/**
 * Ported from oven-sh/bun test/cli/test/bun-test.test.ts @ pinned commit (subset).
 */

import { describe, expect, test } from "bun:test";
import { runBunTestContractProbes } from "../src/lib/bun-cli-bun-test-probes.ts";

describe("bun-cli-bun-test contract probes", () => {
  test("runBunTestContractProbes all pass on current Bun", async () => {
    const failed = (await runBunTestContractProbes()).filter((r) => !r.ok);
    expect(failed).toEqual([]);
  }, 30_000);
});
