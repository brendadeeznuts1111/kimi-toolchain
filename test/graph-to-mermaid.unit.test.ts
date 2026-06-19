import { describe, expect, test } from "bun:test";
import {
  generateArtifactLineageMermaid,
  generateRunLineageMermaid,
  mermaidNodeId,
  shortArtifactLabel,
} from "../src/lib/graph-to-mermaid.ts";

describe("graph-to-mermaid", () => {
  test("shortArtifactLabel compacts gate and timestamp", () => {
    const path = ".kimi/artifacts/model-drift/2026-06-19T14-40-33-297Z.json";
    expect(shortArtifactLabel(path)).toBe("model-drift/2026-06-19T14-40-33-297Z");
  });

  test("mermaidNodeId sanitizes path characters", () => {
    expect(mermaidNodeId(".kimi/artifacts/a/b.json")).toMatch(/^[a-zA-Z_]/);
  });

  test("generateArtifactLineageMermaid emits dependency edges to root", () => {
    const root = ".kimi/artifacts/model-drift/2026-06-19T12-00-00-000Z.json";
    const dep = ".kimi/artifacts/strategy-performance/2026-06-19T11-00-00-000Z.json";
    const mermaid = generateArtifactLineageMermaid(root, [{ paths: [dep] }]);

    expect(mermaid).toStartWith("graph TD");
    expect(mermaid).toContain("model-drift");
    expect(mermaid).toContain("strategy-performance");
    expect(mermaid).toContain("-->");
  });

  test("generateRunLineageMermaid emits edges from upstreamArtifacts", () => {
    const root = ".kimi/artifacts/perf-gate/2026-06-19T12-00-00-000Z.json";
    const upstream = ".kimi/artifacts/bunfig-policy/2026-06-19T11-00-00-000Z.json";
    const mermaid = generateRunLineageMermaid(root, {
      dependencies: ["bunfig-policy"],
      upstreamArtifacts: [upstream],
    });
    expect(mermaid).toContain("bunfig-policy");
    expect(mermaid).toContain("perf-gate");
    expect(mermaid).toContain("-->");
  });

  test("generateArtifactLineageMermaid shows empty hint when no deps resolved", () => {
    const root = ".kimi/artifacts/governance-report/2026-06-19T12-00-00-000Z.json";
    const mermaid = generateArtifactLineageMermaid(root, []);
    expect(mermaid).toContain("no resolved dependencies");
  });
});
