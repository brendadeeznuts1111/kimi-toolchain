import { describe, expect, test } from "bun:test";
import { buildDeepRuntimeReport } from "../src/lib/runtime-introspection.ts";

describe("runtime-introspection", () => {
  test("buildDeepRuntimeReport assembles runtime stack", async () => {
    const report = await buildDeepRuntimeReport();
    expect(report.runtime.version).toBeDefined();
    expect(report.utilsCoverage.total).toBeGreaterThan(0);
    expect(report.fetchedAt).toBeDefined();
  });
});
