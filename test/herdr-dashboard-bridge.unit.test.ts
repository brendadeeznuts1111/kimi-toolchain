import { describe, expect, test } from "bun:test";
import {
  buildDashboardDeepLink,
  parseHerdrCanvasUrl,
  renderHerdrCanvasCompanion,
} from "../src/lib/herdr-dashboard-bridge.ts";

const BASE = "http://127.0.0.1:5678/";

describe("herdr-dashboard-bridge", () => {
  test("buildDashboardDeepLink with runId includes canvas and runId params", () => {
    const url = buildDashboardDeepLink(
      {
        manifestId: "artifact-lineage",
        runId: "run_20260619_182325_b15334d1",
      },
      { baseUrl: BASE }
    );
    expect(url).toContain("canvas=artifact-lineage");
    expect(url).toContain("runId=run_20260619_182325_b15334d1");
    expect(url.startsWith("http://127.0.0.1:5678/")).toBe(true);
  });

  test("buildDashboardDeepLink with diff encodes left..right", () => {
    const url = buildDashboardDeepLink(
      {
        manifestId: "artifact-lineage",
        diff: { left: "run_a", right: "run_b" },
      },
      { baseUrl: BASE }
    );
    expect(url).toContain("diff=run_a..run_b");
  });

  test("parseHerdrCanvasUrl roundtrip matches original context", () => {
    const original = {
      manifestId: "artifact-lineage",
      runId: "run_20260619_182325_b15334d1",
      sessionId: "sess_abc",
      gate: "model-drift",
      diff: { left: "run_a", right: "run_b" },
    };
    const url = buildDashboardDeepLink(original, { baseUrl: BASE });
    expect(parseHerdrCanvasUrl(url)).toEqual(original);
  });

  test("renderHerdrCanvasCompanion produces valid anchor with target blank", () => {
    const html = renderHerdrCanvasCompanion(
      { manifestId: "artifact-lineage", runId: "run_test" },
      { baseUrl: BASE, label: "Open examples" }
    );
    expect(html).toMatch(/^<a href="/);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("Open examples");
    expect(html).toContain("runId=run_test");
  });
});
