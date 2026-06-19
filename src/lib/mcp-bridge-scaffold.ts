/**
 * MCP bridge scaffolds — generate lightweight bridge scripts for common server
 * shapes without modifying the core unified-shell bridge.
 */

import { join } from "path";
import { ensureDir } from "./utils.ts";

export type BridgeKind = "filesystem" | "http" | "sandbox" | "dashboard";

export interface BridgeScaffoldOptions {
  kind: BridgeKind;
  name: string;
  projectRoot?: string;
  targetUrl?: string;
  allowedPaths?: string[];
}

export function bridgeScriptName(name: string, kind: BridgeKind): string {
  return `${name}-${kind}-bridge.ts`;
}

export function generateBridgeScript(options: BridgeScaffoldOptions): string {
  switch (options.kind) {
    case "filesystem":
      return generateFilesystemBridge(options);
    case "http":
      return generateHttpBridge(options);
    case "sandbox":
      return generateSandboxBridge(options);
    case "dashboard":
      return generateDashboardBridge(options);
    default:
      throw new Error(`Unsupported bridge kind: ${(options as BridgeScaffoldOptions).kind}`);
  }
}

export async function writeBridgeScript(
  options: BridgeScaffoldOptions,
  dir: string
): Promise<string> {
  const fileName = bridgeScriptName(options.name, options.kind);
  const path = join(dir, fileName);
  ensureDir(dir);
  await Bun.write(path, generateBridgeScript(options));
  return path;
}

function generateFilesystemBridge(options: BridgeScaffoldOptions): string {
  const root = options.projectRoot ?? "/tmp";
  const allowed = JSON.stringify(options.allowedPaths ?? [root]);
  return `#!/usr/bin/env bun
/**
 * ${options.name} filesystem bridge — scoped file-system MCP server.
 */

import { existsSync } from "fs";
import { resolve } from "path";

const ALLOWED_ROOTS = ${allowed}.map((p: string) => resolve(p));

function isAllowed(target: string): boolean {
  const resolved = resolve(target);
  return ALLOWED_ROOTS.some((root: string) => resolved.startsWith(root));
}

async function handleRequest(request: { method: string; params?: Record<string, unknown> }) {
  const { method, params = {} } = request;
  if (method === "tools/list") {
    return {
      tools: [
        { name: "read_file", description: "Read a file within allowed roots", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
        { name: "list_dir", description: "List a directory within allowed roots", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
      ],
    };
  }
  if (method === "tools/call") {
    const tool = params.name as string;
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    const target = String(args.path ?? "");
    if (!isAllowed(target)) {
      return { content: [{ type: "text", text: "path outside allowed roots" }], isError: true };
    }
    if (tool === "read_file") {
      if (!existsSync(target)) return { content: [{ type: "text", text: "not found" }], isError: true };
      const text = await Bun.file(target).text();
      return { content: [{ type: "text", text }] };
    }
    if (tool === "list_dir") {
      const entries = [...Bun.Glob({}).scanSync(target)];
      return { content: [{ type: "text", text: entries.join("\\n") }] };
    }
  }
  return { error: { code: -32601, message: "Method not found" } };
}

// Minimal stdio JSON-RPC loop
const decoder = new TextDecoder();
let buffer = "";
for await (const chunk of Bun.stdin.stream()) {
  buffer += decoder.decode(chunk, { stream: true });
  const lines = buffer.split("\\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const request = JSON.parse(line);
      const result = await handleRequest(request);
      console.log(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
    } catch (e) {
      console.log(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: String(e) } }));
    }
  }
}
`;
}

function generateHttpBridge(options: BridgeScaffoldOptions): string {
  const targetUrl = options.targetUrl ?? "http://localhost:8080/mcp";
  return `#!/usr/bin/env bun
/**
 * ${options.name} http bridge — forward MCP requests to a remote HTTP endpoint.
 */

const TARGET_URL = ${JSON.stringify(targetUrl)};

async function handleRequest(request: { method: string; params?: Record<string, unknown> }) {
  if (request.method === "tools/list") {
    const response = await fetch(TARGET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: request.params }),
    });
    return await response.json();
  }
  if (request.method === "tools/call") {
    const response = await fetch(TARGET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: request.params }),
    });
    return await response.json();
  }
  return { error: { code: -32601, message: "Method not found" } };
}

const decoder = new TextDecoder();
let buffer = "";
for await (const chunk of Bun.stdin.stream()) {
  buffer += decoder.decode(chunk, { stream: true });
  const lines = buffer.split("\\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const request = JSON.parse(line);
      const result = await handleRequest(request);
      console.log(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
    } catch (e) {
      console.log(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: String(e) } }));
    }
  }
}
`;
}

function generateDashboardBridge(options: BridgeScaffoldOptions): string {
  return `#!/usr/bin/env bun
/**
 * ${options.name} dashboard bridge — thin wrapper around the built-in dashboard MCP.
 */

import { homedir } from "os";
import { join } from "path";

const DASHBOARD_PATH = join(homedir(), ".kimi-code", "tools", "kimi-dashboard-mcp.ts");

const proc = Bun.spawn(["bun", "run", DASHBOARD_PATH], {
  stdio: ["inherit", "inherit", "inherit"],
  env: process.env,
});

await proc.exited;
`;
}

function generateSandboxBridge(options: BridgeScaffoldOptions): string {
  return `#!/usr/bin/env bun
/**
 * ${options.name} sandbox bridge — dry-run wrapper that logs but does not execute.
 */

async function handleRequest(request: { method: string; params?: Record<string, unknown> }) {
  if (request.method === "tools/list") {
    return {
      tools: [
        { name: "execute", description: "Logs the command instead of running it", inputSchema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } },
      ],
    };
  }
  if (request.method === "tools/call") {
    const args = (request.params?.arguments ?? {}) as Record<string, unknown>;
    const command = String(args.command ?? "");
    console.error(\`[sandbox] would execute: \${command}\`);
    return { content: [{ type: "text", text: \`[dry-run] \${command}\` }] };
  }
  return { error: { code: -32601, message: "Method not found" } };
}

const decoder = new TextDecoder();
let buffer = "";
for await (const chunk of Bun.stdin.stream()) {
  buffer += decoder.decode(chunk, { stream: true });
  const lines = buffer.split("\\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const request = JSON.parse(line);
      const result = await handleRequest(request);
      console.log(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
    } catch (e) {
      console.log(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: String(e) } }));
    }
  }
}
`;
}
