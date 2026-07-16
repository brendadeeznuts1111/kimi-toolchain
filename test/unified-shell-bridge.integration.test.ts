import { describe, expect, test } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { makeDir, removePath } from "./helpers.ts";

const BRIDGE = join(import.meta.dir, "..", "src", "bin", "unified-shell-bridge.ts");

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: {
    protocolVersion?: string;
    serverInfo?: { name: string; version: string };
    content?: Array<{ type: string; text: string }>;
    isError?: boolean;
    tools?: Array<{ name: string }>;
  };
  error?: { code: number; message: string };
}

async function sendRequests(
  reqs: JsonRpcRequest[]
): Promise<[JsonRpcResponse, ...JsonRpcResponse[]]> {
  const proc = Bun.spawn(["bun", "run", BRIDGE], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  for (const req of reqs) {
    proc.stdin.write(JSON.stringify(req) + "\n");
  }
  proc.stdin.end();

  const stdout = await Bun.readableStreamToText(proc.stdout);
  await proc.exited;

  const results = stdout
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as JsonRpcResponse);
  return results as [JsonRpcResponse, ...JsonRpcResponse[]];
}

describe("unified-shell-bridge", () => {
  test("initialize returns server info", async () => {
    const [res] = await sendRequests([{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }]);
    expect(res.id).toBe(1);
    expect(res.result?.protocolVersion).toBe("2024-11-05");
    expect(res.result?.serverInfo?.name).toBe("unified-shell");
  });

  test("tools/list exposes execute tool", async () => {
    const [res] = await sendRequests([{ jsonrpc: "2.0", id: 1, method: "tools/list" }]);
    const tools = res.result?.tools || [];
    expect(tools.some((t) => t.name === "execute")).toBe(true);
  });

  test("execute returns stdout and exit code 0", async () => {
    const [res] = await sendRequests([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "execute", arguments: { command: "printf hello" } },
      },
    ]);
    const text = res.result?.content?.map((c) => c.text).join("\n") || "";
    expect(text).toContain("hello");
    expect(text).toContain("exit code: 0");
    expect(res.result?.isError).toBe(false);
  });

  test("execute surfaces stderr separately", async () => {
    const [res] = await sendRequests([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "execute", arguments: { command: "echo err-msg >&2" } },
      },
    ]);
    const text = res.result?.content?.map((c) => c.text).join("\n") || "";
    expect(text).toContain("stderr:");
    expect(text).toContain("err-msg");
    expect(text).toContain("exit code: 0");
    expect(res.result?.isError).toBe(false);
  });

  test("execute marks non-zero exit as error", async () => {
    const [res] = await sendRequests([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "execute", arguments: { command: "exit 7" } },
      },
    ]);
    const text = res.result?.content?.map((c) => c.text).join("\n") || "";
    expect(text).toContain("exit code: 7");
    expect(res.result?.isError).toBe(true);
  });

  test("execute rejects missing workingDir", async () => {
    const missingDir = join(tmpdir(), `kimi-bridge-missing-${Bun.randomUUIDv7()}`);
    const [res] = await sendRequests([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "execute", arguments: { command: "pwd", workingDir: missingDir } },
      },
    ]);
    const text = res.result?.content?.map((c) => c.text).join("\n") || "";
    expect(text).toContain("Working directory does not exist");
    expect(res.result?.isError).toBe(true);
  });

  test("execute runs in provided workingDir", async () => {
    const cwd = join(tmpdir(), `kimi-bridge-cwd-${Bun.randomUUIDv7()}`);
    makeDir(cwd, { recursive: true });
    try {
      const [res] = await sendRequests([
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "execute", arguments: { command: "pwd", workingDir: cwd } },
        },
      ]);
      const text = res.result?.content?.map((c) => c.text).join("\n") || "";
      expect(text).toContain(cwd);
      expect(res.result?.isError).toBe(false);
    } finally {
      removePath(cwd, { recursive: true, force: true });
    }
  });
});
