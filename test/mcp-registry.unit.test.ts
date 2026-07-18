import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { tmpdir } from "os";
import {
  loadMcpRegistry,
  serverEnvAvailable,
  getDefaultServerNames,
  mcpServersDirPath,
  DASHBOARD_MCP_SERVER,
  BUN_DOCS_MCP_TOOLS,
  BUN_DOCS_MCP_URL,
  BUN_DOCS_SERVER,
} from "../src/lib/mcp-registry.ts";
import { makeDir, removePath, writeText } from "./helpers.ts";

let tmpHome: string;

describe("mcp-registry", () => {
  beforeEach(() => {
    tmpHome = join(tmpdir(), `kimi-mcp-registry-${Bun.randomUUIDv7()}`);
    makeDir(tmpHome, { recursive: true });
  });

  afterEach(() => {
    if (tmpHome) removePath(tmpHome, { recursive: true, force: true });
  });

  test("loads built-in unified-shell, cloudflare-api, bun-docs, and dashboard servers", async () => {
    const registry = await loadMcpRegistry(tmpHome);
    expect(registry.servers["unified-shell"]).toBeDefined();
    expect(registry.servers["cloudflare-api"]).toBeDefined();
    expect(registry.servers[BUN_DOCS_SERVER]).toBeDefined();
    expect(registry.servers[DASHBOARD_MCP_SERVER]).toBeDefined();
    expect(registry.builtinNames).toContain("unified-shell");
    expect(registry.builtinNames).toContain("cloudflare-api");
    expect(registry.builtinNames).toContain(BUN_DOCS_SERVER);
    expect(registry.builtinNames).toContain(DASHBOARD_MCP_SERVER);
  });

  test("loads user-defined servers from ~/.kimi-code/mcp-servers/*.toml", async () => {
    const dir = mcpServersDirPath(tmpHome);
    makeDir(dir, { recursive: true });
    writeText(
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

  test("getDefaultServerNames includes only default-active built-ins", async () => {
    const registry = await loadMcpRegistry(tmpHome);
    const names = getDefaultServerNames(registry);
    expect(names).toContain("unified-shell");
    // Anti-bloat: cloudflare-api, bun-docs, and dashboard are opt-in, not default.
    expect(names).not.toContain("cloudflare-api");
    expect(names).not.toContain(BUN_DOCS_SERVER);
    expect(names).not.toContain(DASHBOARD_MCP_SERVER);
  });

  test("dashboard server points to synced dashboard MCP script", async () => {
    const registry = await loadMcpRegistry(tmpHome);
    const dash = registry.servers[DASHBOARD_MCP_SERVER]!;
    expect(dash.command).toMatch(/bun$/);
    expect(dash.args?.some((a) => a.includes("kimi-dashboard-mcp.ts"))).toBe(true);
    expect(dash.default).toBe(false);
  });

  test("bun-docs server points to Bun documentation MCP endpoint", async () => {
    const registry = await loadMcpRegistry(tmpHome);
    const bunDocs = registry.servers[BUN_DOCS_SERVER]!;
    expect(bunDocs.url).toBe(BUN_DOCS_MCP_URL);
    expect(bunDocs.default).toBe(false);
    expect(bunDocs.enabledTools).toEqual([...BUN_DOCS_MCP_TOOLS]);
    expect(serverEnvAvailable(bunDocs)).toBe(true);
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
