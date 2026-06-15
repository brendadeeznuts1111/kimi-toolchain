import { describe, expect, test } from "bun:test";
import { buildAgentsMd } from "../src/lib/scaffold-agents.ts";

describe("buildAgentsMd", () => {
  test("includes project name and Kimi Code sections", () => {
    const md = buildAgentsMd("my-app");
    expect(md).toContain("# Agent Guide — my-app");
    expect(md).toContain("format:check:ci");
    expect(md).toContain("/Users/nolarose/.config/dx/AGENTS.md");
    expect(md).toContain("dx mcp-status");
    expect(md).toContain(".kimi-code/mcp.json");
    expect(md).toContain("Cloudflare SSO/OAuth is separate");
    expect(md).toContain("./CODE_REFERENCES.md");
    expect(md).toContain("~/.kimi-code/CODE_REFERENCES.md");
    expect(md).toContain("kimi-capabilities --json");
    expect(md).toContain("kimi-heal plan --json");
    expect(md).toContain("kimi-heal apply --dry-run");
    expect(md).toContain("kimi-trace <trace-id> --json");
    expect(md).toContain("kimi-contract validate --json");
    expect(md).toContain("kimi-decision log --json");
    expect(md).toContain("kimi-why <topic> --json");
    expect(md).toContain("safeToAutoApply");
    expect(md).toContain("~/.kimi-code/var/trace-events.jsonl");
    expect(md).toContain(
      "Keep destructive operations and dependency changes in manual approval mode"
    );
    expect(md).toContain("kimi-doctor --agent-ready");
    expect(md).toContain("kimi-githooks doctor");
    expect(md).toContain("kimi-doctor --quick");
  });
});
