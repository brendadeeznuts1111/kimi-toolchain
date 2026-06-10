import { describe, expect, test } from "bun:test";
import { buildAgentsMd } from "../src/lib/scaffold-agents.ts";

describe("buildAgentsMd", () => {
  test("includes project name and Kimi Code sections", () => {
    const md = buildAgentsMd("my-app");
    expect(md).toContain("# Agent Guide — my-app");
    expect(md).toContain("format:check:ci");
    expect(md).toContain(".kimi-code/mcp.json");
    expect(md).toContain("kimi-doctor --quick");
  });
});
