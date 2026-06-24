/**
 * Ported from oven-sh/bun test/cli/run/env.test.ts @ pinned commit (subset).
 */

import { describe, expect, test } from "bun:test";
import { runEnvContractProbes } from "../src/lib/bun-cli-env-probes.ts";

describe("bun-cli-env contract probes", () => {
  test("runEnvContractProbes all pass on current Bun", async () => {
    const failed = (await runEnvContractProbes()).filter((r) => !r.ok);
    expect(failed).toEqual([]);
  }, 30_000);
});
