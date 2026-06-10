/**
 * MCP configuration — idempotent unified-shell provisioning for Kimi Code.
 * @see https://moonshotai.github.io/kimi-code/en/customization/mcp.html
 */

import { existsSync } from "fs";
import { join, resolve } from "path";
import { ensureDir } from "./utils.ts";

export const UNIFIED_SHELL_SERVER = "unified-shell";
export const UNIFIED_SHELL_TOOL = "mcp__unified-shell__execute";

export interface McpServerEntry {
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  cwd?: string;
  enabled?: boolean;
  description?: string;
}

export interface McpJson {
  mcpServers: Record<string, McpServerEntry>;
}

export interface McpCheck {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
  fixable: boolean;
}

export interface McpValidationReport {
  checks: McpCheck[];
  userPath: string;
  projectPath: string | null;
}

export function userMcpPath(home: string = Bun.env.HOME || "/tmp"): string {
  return join(home, ".kimi-code", "mcp.json");
}

export function projectMcpPath(projectRoot: string): string {
  return join(resolve(projectRoot), ".kimi-code", "mcp.json");
}

export async function readMcpJson(path: string): Promise<McpJson | null> {
  if (!existsSync(path)) return null;
  try {
    const raw = await Bun.file(path).json();
    if (!raw || typeof raw !== "object") return null;
    const servers = (raw as McpJson).mcpServers;
    return { mcpServers: servers && typeof servers === "object" ? servers : {} };
  } catch {
    return null;
  }
}

export async function writeMcpJson(path: string, data: McpJson): Promise<void> {
  ensureDir(join(path, ".."));
  await Bun.write(path, JSON.stringify(data, null, 2) + "\n");
}

export function resolveBunPath(): string {
  return Bun.which("bun") || "bun";
}

export function bridgeScriptPath(home: string = Bun.env.HOME || "/tmp"): string {
  return join(home, ".kimi-code", "tools", "unified-shell-bridge.ts");
}

/** Canonical stdio entry for unified-shell MCP server. */
export function buildUnifiedShellEntry(home: string = Bun.env.HOME || "/tmp"): McpServerEntry {
  return {
    command: resolveBunPath(),
    args: ["run", bridgeScriptPath(home)],
    env: {
      TERMINAL_BINDING_ENABLED: "true",
      KIMI_SHELL_MODE: "unified",
    },
    description: "Unified Shell Bridge: Bun-native shell execution with signal handling",
  };
}

function entryNeedsRefresh(
  existing: McpServerEntry | undefined,
  expected: McpServerEntry
): boolean {
  if (!existing) return true;
  const scriptPath = bridgeScriptPath();
  const expectedArgs = expected.args?.join(" ") ?? "";
  const existingArgs = existing.args?.join(" ") ?? "";
  if (!existingArgs.includes("unified-shell-bridge.ts")) return true;
  if (existing.command !== expected.command) return true;
  if (!existingArgs.includes(scriptPath) && existingArgs !== expectedArgs) return true;
  return false;
}

/** Merge unified-shell into mcpServers without removing other servers. */
export function mergeUnifiedShellServer(
  existing: McpJson | null,
  home: string = Bun.env.HOME || "/tmp"
): { config: McpJson; changed: boolean } {
  const config: McpJson = {
    mcpServers: existing?.mcpServers ? { ...existing.mcpServers } : {},
  };
  const expected = buildUnifiedShellEntry(home);
  const current = config.mcpServers[UNIFIED_SHELL_SERVER];
  const changed = entryNeedsRefresh(current, expected);
  if (changed) {
    config.mcpServers[UNIFIED_SHELL_SERVER] = expected;
  }
  return { config, changed };
}

export async function provisionUserMcp(home: string = Bun.env.HOME || "/tmp"): Promise<{
  path: string;
  changed: boolean;
}> {
  const path = userMcpPath(home);
  const existing = await readMcpJson(path);
  const { config, changed } = mergeUnifiedShellServer(existing, home);
  if (changed || !existsSync(path)) {
    await writeMcpJson(path, config);
    return { path, changed: true };
  }
  return { path, changed: false };
}

export async function validateMcpConfig(
  home: string = Bun.env.HOME || "/tmp",
  projectRoot?: string
): Promise<McpValidationReport> {
  const checks: McpCheck[] = [];
  const userPath = userMcpPath(home);
  const projectPath = projectRoot ? projectMcpPath(projectRoot) : null;
  const bridgePath = bridgeScriptPath(home);

  if (existsSync(userPath)) {
    checks.push({
      name: "mcp-user",
      status: "ok",
      message: userPath,
      fixable: false,
    });
  } else {
    checks.push({
      name: "mcp-user",
      status: "error",
      message: "missing — run bun run sync or kimi-doctor --fix",
      fixable: true,
    });
  }

  const userMcp = await readMcpJson(userPath);
  if (userMcp?.mcpServers[UNIFIED_SHELL_SERVER]) {
    checks.push({
      name: "unified-shell",
      status: "ok",
      message: `registered (tool: ${UNIFIED_SHELL_TOOL})`,
      fixable: false,
    });
  } else {
    checks.push({
      name: "unified-shell",
      status: "error",
      message: "not in mcpServers — run kimi-doctor --fix",
      fixable: true,
    });
  }

  if (existsSync(bridgePath)) {
    checks.push({
      name: "bridge-script",
      status: "ok",
      message: bridgePath,
      fixable: false,
    });
  } else {
    checks.push({
      name: "bridge-script",
      status: "error",
      message: `missing at ${bridgePath} — run bun run sync`,
      fixable: true,
    });
  }

  const bunPath = resolveBunPath();
  if (bunPath && (bunPath !== "bun" || Bun.which("bun"))) {
    checks.push({
      name: "bun-runtime",
      status: "ok",
      message: bunPath,
      fixable: false,
    });
  } else {
    checks.push({
      name: "bun-runtime",
      status: "error",
      message: "bun not found on PATH",
      fixable: false,
    });
  }

  if (projectPath && existsSync(projectPath)) {
    const projectMcp = await readMcpJson(projectPath);
    if (!projectMcp) {
      checks.push({
        name: "mcp-project",
        status: "warn",
        message: `${projectPath} — invalid JSON`,
        fixable: false,
      });
    } else {
      const serverNames = Object.keys(projectMcp.mcpServers);
      const summary =
        serverNames.length === 0
          ? "empty stub (inherits user-level servers)"
          : `${serverNames.length} server(s): ${serverNames.join(", ")}`;
      checks.push({
        name: "mcp-project",
        status: "ok",
        message: `${projectPath} — ${summary}`,
        fixable: false,
      });

      const override = projectMcp.mcpServers[UNIFIED_SHELL_SERVER];
      if (override) {
        if (override.enabled === false) {
          checks.push({
            name: "mcp-project-override",
            status: "warn",
            message: "unified-shell disabled at project level",
            fixable: false,
          });
        } else if (!override.command && !override.url) {
          checks.push({
            name: "mcp-project-override",
            status: "error",
            message: "unified-shell override missing command or url",
            fixable: false,
          });
        } else {
          const args = override.args?.join(" ") ?? "";
          const usesBridge = args.includes("unified-shell-bridge");
          checks.push({
            name: "mcp-project-override",
            status: usesBridge || !!override.url ? "ok" : "warn",
            message: usesBridge
              ? "unified-shell project override uses toolchain bridge"
              : "custom unified-shell override (not toolchain bridge)",
            fixable: false,
          });
        }
      }
    }
  }

  return { checks, userPath, projectPath };
}

export async function fixMcpConfig(
  home: string = Bun.env.HOME || "/tmp",
  projectRoot?: string
): Promise<{ userChanged: boolean; projectCreated: boolean }> {
  const { changed: userChanged } = await provisionUserMcp(home);

  let projectCreated = false;
  if (projectRoot) {
    const projPath = projectMcpPath(projectRoot);
    if (!existsSync(projPath)) {
      ensureDir(join(projPath, ".."));
      const stub: McpJson = {
        mcpServers: {},
      };
      await writeMcpJson(projPath, stub);
      projectCreated = true;
    }
  }

  return { userChanged, projectCreated };
}

/** Project-level mcp.json stub content for scaffolding. */
export function projectMcpStub(): string {
  return (
    JSON.stringify(
      {
        mcpServers: {},
        _comment:
          "Project MCP servers override ~/.kimi-code/mcp.json entries with the same name. See UNIFIED.md.",
      },
      null,
      2
    ) + "\n"
  );
}
