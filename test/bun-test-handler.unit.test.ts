import { describe, expect, test } from "bun:test";
import { apiBunTest } from "../examples/dashboard/src/handlers/bun-test.ts";
import { BUN_TEST_CHANGED_IMPORT_GRAPH } from "../src/lib/test-runtime.ts";

describe("bun-test-handler", () => {
  test("apiBunTest exposes changed import-graph mechanics for portal card", async () => {
    const res = await apiBunTest();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      changedImportGraph: typeof BUN_TEST_CHANGED_IMPORT_GRAPH;
      cliFlags: { flag: string }[];
    };
    expect(body.changedImportGraph).toEqual(BUN_TEST_CHANGED_IMPORT_GRAPH);
    expect(body.changedImportGraph.pipeline).toHaveLength(4);
    expect(body.changedImportGraph.kimiScripts.map((s) => s.script)).toEqual([
      "test:changed",
      "test:changed:push",
      "test:changed:shard",
    ]);
    expect(body.cliFlags.some((f) => f.flag === "--changed")).toBe(true);
  });
});