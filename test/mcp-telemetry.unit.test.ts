import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { recordMcpInvocation, mcpInvocationTaxonomy } from "../src/lib/mcp-telemetry.ts";

describe("mcp-telemetry", () => {
  let tmpDir: string;
  let path: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `kimi-mcp-telemetry-${Bun.randomUUIDv7()}`);
    mkdirSync(tmpDir, { recursive: true });
    path = join(tmpDir, "mcp-invocations.ndjson");
  });

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  test("records an MCP invocation", async () => {
    const record = await recordMcpInvocation(
      {
        server: "unified-shell",
        tool: "execute",
        latencyMs: 42,
        outcome: "success",
      },
      path
    );
    expect(record.schemaVersion).toBe(1);
    expect(record.server).toBe("unified-shell");
    expect(record.outcome).toBe("success");
    expect(record.timestamp).toBeTruthy();

    const lines = (await Bun.file(path).text()).trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.tool).toBe("execute");
  });

  test("maps outcomes to taxonomy ids", () => {
    expect(mcpInvocationTaxonomy("success")).toBe("mcp_invocation_success");
    expect(mcpInvocationTaxonomy("error")).toBe("mcp_invocation_error");
    expect(mcpInvocationTaxonomy("blocked")).toBe("mcp_invocation_blocked");
  });
});
