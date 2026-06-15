import { describe, expect, test } from "bun:test";
import { join } from "path";
import { AGENT_CONTEXT_TARGET_SCORE, scoreAgentContext } from "../src/lib/agent-context-quality.ts";

const REPO_ROOT = join(import.meta.dir, "..");

const QUALITY_FILES = [
  "AGENTS.md",
  "CONTEXT.md",
  "skills/kimi-toolchain/SKILL.md",
  "skills/kimi-toolchain/agents/openai.yaml",
  "src/lib/scaffold-agents.ts",
  "src/lib/githook-templates.ts",
  "test/test-gates.unit.test.ts",
] as const;

describe("agent context quality", () => {
  test("agent context and skill meet the 15 percent quality lift target", async () => {
    const files: Record<string, string> = {};
    for (const file of QUALITY_FILES) {
      files[file] = await Bun.file(join(REPO_ROOT, file)).text();
    }

    const report = scoreAgentContext(files);
    const failedCriteria = report.results
      .filter((result) => !result.passed)
      .map((result) => result.id);

    expect(report.targetScore).toBe(AGENT_CONTEXT_TARGET_SCORE);
    expect(report.score).toBeGreaterThanOrEqual(AGENT_CONTEXT_TARGET_SCORE);
    expect(report.improvementPct).toBeGreaterThanOrEqual(15);
    expect(failedCriteria).toEqual([]);
  });
});
