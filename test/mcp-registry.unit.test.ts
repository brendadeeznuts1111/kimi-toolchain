import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  loadMcpRegistry,
  serverEnvAvailable,
  getDefaultServerNames,
  mcpServersDirPath,
  DASHBOARD_MCP_SERVER,
} from "../src/lib/mcp-registry.ts";

let tmpHome: string;

describe("mcp-registry", () => {
  beforeEach(() => {
    tmpHome = join(tmpdir(), `kimi-mcp-registry-${Bun.randomUUIDv7()}`);
    mkdirSync(tmpHome, { recursive: true });
  });

  afterEach(() => {
    if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  });

  test("loads built-in unified-shell, cloudflare-api, and dashboard servers", async () => {
    const registry = await loadMcpRegistry(tmpHome);
    expect(registry.servers["unified-shell"]).toBeDefined();
    expect(registry.servers["cloudflare-api"]).toBeDefined();
    expect(registry.servers[DASHBOARD_MCP_SERVER]).toBeDefined();
    expect(registry.builtinNames).toContain("unified-shell");
    expect(registry.builtinNames).toContain("cloudflare-api");
    expect(registry.builtinNames).toContain(DASHBOARD_MCP_SERVER);
  });

  test("loads user-defined servers from ~/.kimi-code/mcp-servers/*.toml", async () => {
    const dir = mcpServersDirPath(tmpHome);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "github.toml"),
      `command = "bun"
args = ["run", "github-mcp.ts"]
description = "GitHub MCP server"
requiredEnv = ["GITHUB_TOKEN"]
`
    );

    const registry = await loadMcpRegistry(tmpHome);
    expect(registry.userNames).toContain("github");
    expect(registry.servers["github"]?.command).toBe("bun");
    expect(registry.servers["github"]?.requiredEnv).toEqual(["GITHUB_TOKEN"]);
  });

  test("getDefaultServerNames includes built-in defaults", async () => {
    const registry = await loadMcpRegistry(tmpHome);
    const names = getDefaultServerNames(registry);
    expect(names).toContain("unified-shell");
    expect(names).toContain("cloudflare-api");
    expect(names).not.toContain(DASHBOARD_MCP_SERVER);
  });

  test("dashboard server points to synced dashboard MCP script", async () => {
    const registry = await loadMcpRegistry(tmpHome);
    const dash = registry.servers[DASHBOARD_MCP_SERVER]!;
    expect(dash.command).toMatch(/bun$/);
    expect(dash.args?.some((a) => a.includes("kimi-dashboard-mcp.ts"))).toBe(true);
    expect(dash.default).toBe(false);
  });

  test("serverEnvAvailable checks required env vars", async () => {
    const registry = await loadMcpRegistry(tmpHome);
    const cloudflare = registry.servers["cloudflare-api"]!;
    const original = Bun.env.CLOUDFLARE_API_TOKEN;
    try {
      delete Bun.env.CLOUDFLARE_API_TOKEN;
      expect(serverEnvAvailable(cloudflare)).toBe(false);
      Bun.env.CLOUDFLARE_API_TOKEN = "test-token";
      expect(serverEnvAvailable(cloudflare)).toBe(true);
    } finally {
      if (original !== undefined) Bun.env.CLOUDFLARE_API_TOKEN = original;
      else delete Bun.env.CLOUDFLARE_API_TOKEN;
    }
  });
});
