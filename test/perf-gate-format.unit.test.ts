import { describe, expect, test } from "bun:test";
import { formatPerfProfilingHints, withPerfProfilingHints } from "../src/lib/perf-gate-format.ts";
import { BUN_BENCHMARKING_DOC_URL } from "../src/lib/bun-install-config.ts";

describe("perf-gate-format", () => {
  test("formatPerfProfilingHints references Bun benchmarking doc commands", () => {
    const hints = formatPerfProfilingHints("run bench");
    expect(hints).toContain("--cpu-prof-md");
    expect(hints).toContain("--heap-prof-md");
    expect(hints).toContain("MIMALLOC_SHOW_STATS=1");
    expect(hints).toContain(BUN_BENCHMARKING_DOC_URL);
    expect(hints).toContain("run bench");
  });

  test("withPerfProfilingHints appends hints only when failures exist", () => {
    expect(withPerfProfilingHints([])).toEqual([]);
    const out = withPerfProfilingHints(["fail: demo"]);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe("fail: demo");
    expect(out[1]).toContain("perf profiling");
  });
});
