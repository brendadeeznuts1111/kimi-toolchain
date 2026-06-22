import { describe, expect, test } from "bun:test";
import { inspectWorkspaceRuntime } from "../src/lib/workspace-runtime.ts";

describe("workspace-runtime", () => {
  test("inspectWorkspaceRuntime reports kimi-code paths", async () => {
    const snap = await inspectWorkspaceRuntime();
    expect(snap.kimiCode.desktopRoot).toContain(".kimi-code");
    expect(snap.kimiCode.mcpJson).toContain("mcp.json");
  });
});
