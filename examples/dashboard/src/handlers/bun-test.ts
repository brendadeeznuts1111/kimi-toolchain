// ── Bun Test ───────────────────────────────────────────────────────

export async function apiBunTest(): Promise<Response> {
  return jsonResponse({
    imports: ['test', 'expect', 'describe', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll', 'mock', 'spyOn'],
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
      "toBe(value)", "toEqual(value)", "toStrictEqual(value)",
      "toBeNull()", "toBeUndefined()", "toBeTruthy()", "toBeFalsy()",
      "toMatch(regex)", "toMatchSnapshot()",
      "toBeArray()", "toContain(item)", "toContainEqual(item)",
      "toThrow()", "toThrowErrorLike(obj)",
      "toBeInstanceOf(cls)", "toBeNaN()", "toBeFinite()",
      "toBeGreaterThan(n)", "toBeLessThan(n)",
      "toHaveProperty(key)", "toHaveLength(n)",
    ],
    mockFunctions: [
      "mock(() => value)", "mock((arg) => result)",
      "spyOn(obj, 'method')",
    ],
    runCommand: "bun test",
    cliFlags: [
      { flag: "--filter", value: '"@myorg/*"', description: "Run tests in matching workspace packages" },
      { flag: "--shard", value: "1/4", description: "Split tests across CI jobs (deterministic round-robin)" },
      { flag: "--parallel", value: "4", description: "Run N test files concurrently (work-stealing)" },
      { flag: "--isolate", description: "Run each test file in a separate subprocess" },
      { flag: "--rerun-each", value: "3", description: "Re-run each test file N times for flake hunting" },
      { flag: "--bail", value: "5", description: "Exit after N test failures" },
      { flag: "--timeout", value: "10000", description: "Per-test timeout in ms" },
    ],
    note: "bun:test — Bun's built-in test runner. --filter for monorepos, --shard for CI splitting, --parallel for speed, --isolate per process. expect() only inside test() blocks. Snapshot helper: Bun.inspect + Bun.stripANSI + toMatchSnapshot for color-stable output.",
  });
}

