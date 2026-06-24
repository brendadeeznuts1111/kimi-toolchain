/**
 * Ported from oven-sh/bun test/cli/run/markdown-entrypoint.test.ts @ pinned commit (subset).
 */

import { describe, expect, test } from "bun:test";
import { runMarkdownEntrypointContractProbes } from "../src/lib/bun-cli-markdown-probes.ts";

describe("bun-cli-markdown contract probes", () => {
  test("runMarkdownEntrypointContractProbes all pass on current Bun", async () => {
    const failed = (await runMarkdownEntrypointContractProbes()).filter((r) => !r.ok);
    expect(failed).toEqual([]);
  }, 30_000);
});
