import { describe, expect, test } from "bun:test";
import { join } from "path";
import { makeDir, removePath, writeText } from "../src/lib/bun-io.ts";
import { testTempDir, testTempPath } from "./helpers.ts";

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

async function sendRequests(reqs: JsonRpcRequest[]): Promise<JsonRpcResponse[]> {
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

  return stdout
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as JsonRpcResponse);
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
    const missingDir = testTempPath("kimi-bridge-missing-");
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

  test("execute rejects non-string workingDir", async () => {
    const [res] = await sendRequests([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "execute", arguments: { command: "pwd", workingDir: { path: "/" } } },
      },
    ]);
    expect(res.error?.code).toBe(-32602);
    expect(res.error?.message).toContain("Invalid 'workingDir'");
  });

  test("execute rejects non-number timeout and output limits", async () => {
    const [timeoutRes, outputRes] = await sendRequests([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "execute", arguments: { command: "pwd", timeoutMs: "50" } },
      },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "execute", arguments: { command: "pwd", maxOutputBytes: "8" } },
      },
    ]);
    expect(timeoutRes.error?.code).toBe(-32602);
    expect(timeoutRes.error?.message).toContain("Invalid 'timeoutMs'");
    expect(outputRes.error?.code).toBe(-32602);
    expect(outputRes.error?.message).toContain("Invalid 'maxOutputBytes'");
  });

  test("execute rejects file workingDir", async () => {
    const filePath = testTempPath("kimi-bridge-file-");
    writeText(filePath, "not a directory");
    try {
      const [res] = await sendRequests([
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "execute", arguments: { command: "pwd", workingDir: filePath } },
        },
      ]);
      const text = res.result?.content?.map((c) => c.text).join("\n") || "";
      expect(text).toContain("Working directory is not a directory");
      expect(res.result?.isError).toBe(true);
    } finally {
      removePath(filePath, { force: true });
    }
  });

  test("execute runs in provided workingDir", async () => {
    const cwd = testTempDir("kimi-bridge-cwd-");
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

  test("execute truncates retained stdout", async () => {
    const [res] = await sendRequests([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "execute",
          arguments: { command: "printf 1234567890abcdef", maxOutputBytes: 8 },
        },
      },
    ]);
    const text = res.result?.content?.map((c) => c.text).join("\n") || "";
    expect(text).toContain("12345678");
    expect(text).not.toContain("90abcdef");
    expect(text).toContain("stdout truncated at: 8 bytes");
    expect(res.result?.isError).toBe(false);
  });

  test("execute times out long-running commands", async () => {
    const [res] = await sendRequests([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "execute", arguments: { command: "sleep 1", timeoutMs: 50 } },
      },
    ]);
    const text = res.result?.content?.map((c) => c.text).join("\n") || "";
    expect(text).toContain("Command timed out after 50ms");
    expect(text).toContain("timed out after: 50ms");
    expect(res.result?.isError).toBe(true);
  });
});
