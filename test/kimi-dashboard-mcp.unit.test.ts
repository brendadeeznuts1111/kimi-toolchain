import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import type { Subprocess } from "bun";

const SCRIPT = join(import.meta.dir, "..", "src", "bin", "kimi-dashboard-mcp.ts");
const PROJECT_ROOT = join(import.meta.dir, "..");

class McpSession {
  proc: Subprocess<"pipe", "pipe", "pipe">;
  private pending = new Map<
    number | string,
    { resolve: (value: unknown) => void; reject: (err: Error) => void }
  >();
  private readerDone = false;

  constructor() {
    this.proc = Bun.spawn(["bun", "run", SCRIPT], {
      cwd: PROJECT_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...Bun.env, KIMI_PROJECT_ROOT: PROJECT_ROOT },
    });
    this.readLoop();
  }

  private async readLoop() {
    const reader = this.proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.id !== undefined && this.pending.has(msg.id)) {
              const p = this.pending.get(msg.id)!;
              this.pending.delete(msg.id);
              p.resolve(msg);
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    } finally {
      this.readerDone = true;
      reader.releaseLock();
      for (const p of this.pending.values()) {
        p.reject(new Error("MCP stdout closed"));
      }
      this.pending.clear();
    }
  }

  async request(
    method: string,
    params?: Record<string, unknown>,
    id?: number | string
  ): Promise<unknown> {
    const request: Record<string, unknown> = { jsonrpc: "2.0", method };
    if (id !== undefined) request.id = id;
    if (params !== undefined) request.params = params;
    const line = JSON.stringify(request) + "\n";

    return new Promise((resolve, reject) => {
      if (this.readerDone) {
        reject(new Error("MCP session closed"));
        return;
      }
      if (id !== undefined) this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(line);
      if (id === undefined) resolve(undefined);
    });
  }

  close() {
    try {
      this.proc.kill();
    } catch {
      // ignore
    }
  }
}

describe("kimi-dashboard-mcp", () => {
  let session: McpSession;

  beforeEach(() => {
    session = new McpSession();
  });

  afterEach(() => {
    session.close();
  });

  test("responds to initialize", async () => {
    const res = (await session.request(
      "initialize",
      {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      },
      1
    )) as { result?: { serverInfo?: { name: string } } };
    expect(res.result?.serverInfo?.name).toBe("kimi-dashboard-mcp");
  });

  test("lists dashboard tools", async () => {
    await session.request(
      "initialize",
      {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      },
      1
    );
    await session.request("notifications/initialized");
    const res = (await session.request("tools/list", {}, 2)) as {
      result?: { tools?: { name: string }[] };
    };
    const names = res.result?.tools?.map((t) => t.name) ?? [];
    expect(names).toContain("project_status");
    expect(names).toContain("health_snapshot");
    expect(names).toContain("effect_gates");
    expect(names).toContain("doctor_runs");
    expect(names).toContain("debug_logs");
  });

  test("project_status returns a status object", async () => {
    await session.request(
      "initialize",
      {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      },
      1
    );
    await session.request("notifications/initialized");
    const res = (await session.request(
      "tools/call",
      { name: "project_status", arguments: {} },
      2
    )) as { result?: { content?: { text: string }[] } };
    const text = res.result?.content?.[0]?.text ?? "";
    expect(text).toContain("projectRoot");
  });
});
