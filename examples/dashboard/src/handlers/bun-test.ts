// ── Bun Test ───────────────────────────────────────────────────────
import { BUN_TEST_CHANGED_IMPORT_GRAPH } from "../../../../src/lib/test-runtime.ts";
import { jsonResponse } from "./shared.ts";

export async function apiBunTest(): Promise<Response> {
  return jsonResponse({
    imports: [
      "test",
      "expect",
      "describe",
      "beforeEach",
      "afterEach",
      "beforeAll",
      "afterAll",
      "mock",
      "spyOn",
    ],
    sampleTest: `import { test, expect } from "bun:test";

test("trace formatting", () => {
  const traces = [
    { traceId: "req-001", status: 200, contentType: "application/json", bodyHash: Bun.SHA256.hash("hello") },
  ];
  expect(traces[0].status).toBe(200);
  expect(traces[0].traceId).toMatch(/^req-/);
  expect(traces).toBeArray();
});`,
    snapshotHelper: `import { test, expect } from "bun:test";

// Reusable snapshot helper for any inspect output
const snapshot = (label, data, opts) => {
  test(label, () => {
    const out = Bun.inspect(data, { colors: true, sorted: true, ...opts });
    expect(Bun.stripANSI(out)).toMatchSnapshot();
  });
};

snapshot("HTTP trace table", traces, { depth: 2 });
snapshot("Deep error stack", error, { depth: 6, showHidden: true });`,
    expectMatchers: [
      "toBe(value)",
      "toEqual(value)",
      "toStrictEqual(value)",
      "toBeNull()",
      "toBeUndefined()",
      "toBeTruthy()",
      "toBeFalsy()",
      "toMatch(regex)",
      "toMatchSnapshot()",
      "toBeArray()",
      "toContain(item)",
      "toContainEqual(item)",
      "toThrow()",
      "toThrowErrorLike(obj)",
      "toBeInstanceOf(cls)",
      "toBeNaN()",
      "toBeFinite()",
      "toBeGreaterThan(n)",
      "toBeLessThan(n)",
      "toHaveProperty(key)",
      "toHaveLength(n)",
    ],
    mockFunctions: ["mock(() => value)", "mock((arg) => result)", "spyOn(obj, 'method')"],
    runCommand: "bun test",
    cliFlags: [
      {
        flag: "--changed",
        value: "HEAD",
        description: "Git import-graph filter — run tests transitively depending on changed files",
      },
      {
        flag: "--changed",
        value: "main",
        description: "Import-graph filter since branch or commit ref",
      },
      {
        flag: "--filter",
        value: '"@myorg/*"',
        description: "Run tests in matching workspace packages",
      },
      {
        flag: "--shard",
        value: "1/4",
        description: "Split tests across CI jobs (deterministic round-robin by file)",
      },
      {
        flag: "--parallel",
        value: "4",
        description: "Run N test files concurrently (work-stealing)",
      },
      { flag: "--isolate", description: "Run each test file in a separate subprocess" },
      {
        flag: "--rerun-each",
        value: "3",
        description: "Re-run each test file N times for flake hunting",
      },
      { flag: "--bail", value: "5", description: "Exit after N test failures" },
      { flag: "--timeout", value: "10000", description: "Per-test timeout in ms" },
    ],
    changedImportGraph: BUN_TEST_CHANGED_IMPORT_GRAPH,
    note: "bun:test — Bun's built-in test runner. --changed uses static import-graph selection; --shard/--parallel distribute by file. expect() only inside test() blocks.",
  });
}