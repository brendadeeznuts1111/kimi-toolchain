import { describe, expect, test } from "bun:test";
import {
  changedTouchesDashboardHarness,
  normalizeDashboardPath,
  registryKeysForChanged,
} from "../registry-scope.ts";

describe("registry-scope", () => {
  test("normalizeDashboardPath strips examples/dashboard prefix", () => {
    expect(normalizeDashboardPath("examples/dashboard/src/harness/file-bench.ts")).toBe(
      "src/harness/file-bench.ts",
    );
  });

  test("http-bench change scopes to http registry keys", () => {
    const keys = registryKeysForChanged(["examples/dashboard/src/harness/http-bench.ts"]);
    expect(keys).toContain("http.fetch-h1");
    expect(keys).toContain("http.fetch-h2");
    expect(keys).not.toContain("crypto.sha256");
  });

  test("perf infra change runs full registry", () => {
    expect(
      registryKeysForChanged(["examples/dashboard/src/harness/perf-monitor.ts"]),
    ).toBeNull();
  });

  test("unrelated repo paths yield empty scope", () => {
    expect(registryKeysForChanged(["README.md", "src/lib/paths.ts"])).toEqual([]);
  });

  test("changedTouchesDashboardHarness detects dashboard edits", () => {
    expect(changedTouchesDashboardHarness(["examples/dashboard/package.json"])).toBe(true);
    expect(changedTouchesDashboardHarness(["package.json"])).toBe(false);
  });
});