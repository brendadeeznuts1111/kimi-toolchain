import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { desktopRoot } from "../src/lib/paths.ts";
import {
  buildBunDocsEntry,
  buildCloudflareApiEntry,
  buildUnifiedShellEntry,
  callMcpTool,
  CLOUDFLARE_API_SERVER,
  MCP_DEFAULTS,
  mergeRegistryMcpServers,
  mergeToolchainMcpServers,
  mergeUnifiedShellServer,
  provisionUserMcp,
  readMcpJson,
  UNIFIED_SHELL_SERVER,
  userMcpPath,
  validateMcpConfig,
  writeMcpJson,
} from "../src/lib/mcp-config.ts";
import { BUN_DOCS_MCP_URL, BUN_DOCS_SERVER } from "../src/lib/mcp-registry.ts";
import { withEnv, makeDir, pathExists, removePath } from "./helpers.ts";

let tmpHome: string;

describe("mcp-config", () => {
  beforeEach(async () => {
    tmpHome = join(tmpdir(), `kimi-mcp-${Bun.randomUUIDv7()}`);
    makeDir(tmpHome, { recursive: true });
    makeDir(join(tmpHome, ".kimi-code", "tools"), { recursive: true });
    await Bun.write(
      join(tmpHome, ".kimi-code", "tools", "unified-shell-bridge.ts"),
      "// bridge stub\n"
    );
  });

  afterEach(() => {
    if (tmpHome) removePath(tmpHome, { recursive: true, force: true });
  });

  test("buildUnifiedShellEntry uses absolute bun and bridge path", () => {
    const entry = buildUnifiedShellEntry(tmpHome);
    expect(entry.command).toBeTruthy();
    expect(entry.args?.join(" ")).toContain("unified-shell-bridge.ts");
    expect(entry.env?.KIMI_SHELL_MODE).toBe("unified");
  });

  test("mergeToolchainMcpServers adds unified-shell and cloudflare-api without removing others", () => {
    const existing = {
      mcpServers: {
        other: { url: "https://example.com/mcp" },
      },
    };
    const { config, changed } = mergeToolchainMcpServers(existing, tmpHome);
    expect(changed).toBe(true);
    expect(config.mcpServers.other?.url).toBe("https://example.com/mcp");
    expect(config.mcpServers[UNIFIED_SHELL_SERVER]).toBeDefined();
    expect(config.mcpServers[CLOUDFLARE_API_SERVER]).toBeDefined();
    expect(config.mcpServers[BUN_DOCS_SERVER]).toBeDefined();
  });

  test("mergeToolchainMcpServers is idempotent when entries match", () => {
    const { config: first } = mergeToolchainMcpServers(null, tmpHome);
    const { config: second, changed } = mergeToolchainMcpServers(first, tmpHome);
    expect(second.mcpServers[UNIFIED_SHELL_SERVER]?.command).toBe(
      first.mcpServers[UNIFIED_SHELL_SERVER]?.command
    );
    expect(second.mcpServers[CLOUDFLARE_API_SERVER]?.url).toBe(
      first.mcpServers[CLOUDFLARE_API_SERVER]?.url
    );
    expect(second.mcpServers[BUN_DOCS_SERVER]?.url).toBe(first.mcpServers[BUN_DOCS_SERVER]?.url);
    expect(changed).toBe(false);
  });

  test("mergeUnifiedShellServer is backward-compatible alias", () => {
    const { config, changed } = mergeUnifiedShellServer(null, tmpHome);
    expect(changed).toBe(true);
    expect(config.mcpServers[UNIFIED_SHELL_SERVER]).toBeDefined();
    expect(config.mcpServers[CLOUDFLARE_API_SERVER]).toBeDefined();
    expect(config.mcpServers[BUN_DOCS_SERVER]).toBeDefined();
  });

  test("buildCloudflareApiEntry points to Cloudflare MCP URL", () => {
    const entry = buildCloudflareApiEntry();
    expect(entry.url).toBe("https://mcp.cloudflare.com/mcp");
  });

  test("buildBunDocsEntry points to Bun docs MCP URL", () => {
    const entry = buildBunDocsEntry();
    expect(entry.url).toBe(BUN_DOCS_MCP_URL);
  });

  test("mergeRegistryMcpServers refreshes stale bun-docs URL", async () => {
    const existing = {
      mcpServers: {
        [BUN_DOCS_SERVER]: { url: "https://old.example/mcp" },
      },
    };
    const { config, changed } = await mergeRegistryMcpServers(existing, tmpHome);
    expect(changed).toBe(true);
    expect(config.mcpServers[BUN_DOCS_SERVER]?.url).toBe(BUN_DOCS_MCP_URL);
  });

  test("provisionUserMcp creates mcp.json with default servers only", async () => {
    await withEnv({ HOME: tmpHome }, async () => {
      const path = userMcpPath();
      // Clean up any pre-existing file from other test runs
      if (pathExists(path)) removePath(path, { force: true });
      expect(pathExists(path)).toBe(false);
      const result = await provisionUserMcp(tmpHome);
      expect(result.changed).toBe(true);
      expect(pathExists(path)).toBe(true);
      const parsed = await readMcpJson(path);
      expect(parsed?.data?.mcpServers[UNIFIED_SHELL_SERVER]).toBeDefined();
      // Anti-bloat: opt-in servers are not provisioned by default.
      expect(parsed?.data?.mcpServers[CLOUDFLARE_API_SERVER]).toBeUndefined();
      expect(parsed?.data?.mcpServers[BUN_DOCS_SERVER]).toBeUndefined();
    });
  });

  test("writeMcpJson round-trips", async () => {
    const path = join(tmpHome, "mcp-test.json");
    const data = { mcpServers: { test: { command: "echo" } } };
    await writeMcpJson(path, data);
    const read = await readMcpJson(path);
    expect(read?.data?.mcpServers.test?.command).toBe("echo");
  });

  test("validateMcpConfig reports cloudflare-api and project stub/override issues", async () => {
    await withEnv({ HOME: tmpHome, CLOUDFLARE_API_TOKEN: "test-token" }, async () => {
      const path = userMcpPath();
      if (pathExists(path)) removePath(path, { force: true });
      await provisionUserMcp(tmpHome);
      // Opt in to non-default servers (anti-bloat: not provisioned by default).
      const { data: provisioned } = await readMcpJson(path);
      const { config: optedIn } = mergeToolchainMcpServers(provisioned, tmpHome);
      await writeMcpJson(path, optedIn);
      const report = await validateMcpConfig(tmpHome);
      const cfCheck = report.checks.find((c) => c.name === "cloudflare-api-mcp");
      expect(cfCheck?.status).toBe("ok");
      expect(cfCheck?.message).toContain("Cloudflare API");

      const bunDocsCheck = report.checks.find((c) => c.name === "bun-docs-mcp");
      expect(bunDocsCheck?.status).toBe("ok");
      expect(bunDocsCheck?.message).toContain("Bun docs MCP");

      const projectRoot = join(tmpHome, "proj");
      const projectMcp = join(projectRoot, ".kimi-code", "mcp.json");
      makeDir(join(projectRoot, ".kimi-code"), { recursive: true });
      await writeMcpJson(projectMcp, { mcpServers: {} });

      const stubReport = await validateMcpConfig(tmpHome, projectRoot);
      const projectCheck = stubReport.checks.find((c) => c.name === "mcp-project");
      expect(projectCheck?.status).toBe("ok");
      expect(projectCheck?.message).toContain("empty stub");

      await writeMcpJson(projectMcp, {
        mcpServers: { [UNIFIED_SHELL_SERVER]: { enabled: false } },
      });
      const disabledReport = await validateMcpConfig(tmpHome, projectRoot);
      expect(
        disabledReport.checks.find((c) => c.name === "mcp-project-override")?.message
      ).toContain("disabled");
    });
  });

  describe("callMcpTool", () => {
    test("returns error for unknown server", async () => {
      await withEnv({ HOME: tmpHome }, async () => {
        const mcpJsonPath = join(desktopRoot(tmpHome), "mcp.json");
        const result = await callMcpTool("totally-unknown-mcp-server", "some_tool", {}, tmpHome);
        expect(result.ok).toBe(false);
        expect(result.error).toBe(
          `MCP server 'totally-unknown-mcp-server' not found in registry or ${mcpJsonPath}`
        );
        expect(result.latencyMs).toBe(0);
      });
    });

    test("returns error for disabled server", async () => {
      await withEnv({ HOME: tmpHome }, async () => {
        const path = userMcpPath();
        await writeMcpJson(path, {
          mcpServers: {
            [BUN_DOCS_SERVER]: { url: BUN_DOCS_MCP_URL, enabled: false },
          },
        });
        const result = await callMcpTool(BUN_DOCS_SERVER, "search_bun", { query: "test" }, tmpHome);
        expect(result.ok).toBe(false);
        expect(result.error).toBe(`MCP server '${BUN_DOCS_SERVER}' is disabled`);
        expect(result.latencyMs).toBe(0);
      });
    });

    test("returns error for missing required env", async () => {
      await withEnv({ HOME: tmpHome, CLOUDFLARE_API_TOKEN: undefined }, async () => {
        const path = userMcpPath();
        await writeMcpJson(path, {
          mcpServers: {
            [CLOUDFLARE_API_SERVER]: { url: "https://mcp.cloudflare.com/mcp" },
          },
        });
        const result = await callMcpTool(
          CLOUDFLARE_API_SERVER,
          "mcp__cloudflare__search",
          { query: "workers" },
          tmpHome
        );
        expect(result.ok).toBe(false);
        expect(result.error).toBe("missing env: CLOUDFLARE_API_TOKEN");
        expect(result.latencyMs).toBe(0);
      });
    });

    test("returns error for stdio-only server", async () => {
      await withEnv({ HOME: tmpHome }, async () => {
        const result = await callMcpTool(UNIFIED_SHELL_SERVER, "execute", {}, tmpHome);
        expect(result.ok).toBe(false);
        expect(result.error).toBe(
          `MCP server '${UNIFIED_SHELL_SERVER}' is not an HTTP/SSE server (missing url)`
        );
        expect(result.latencyMs).toBe(0);
      });
    });

    test("honors home parameter for mcp.json without matching HOME", async () => {
      const altHome = join(tmpdir(), `kimi-alt-${Bun.randomUUIDv7()}`);
      makeDir(join(altHome, ".kimi-code"), { recursive: true });
      try {
        await writeMcpJson(join(altHome, ".kimi-code", "mcp.json"), {
          mcpServers: {
            [BUN_DOCS_SERVER]: { url: BUN_DOCS_MCP_URL, enabled: false },
          },
        });
        await withEnv({ HOME: tmpHome }, async () => {
          const result = await callMcpTool(BUN_DOCS_SERVER, "search_bun", {}, altHome);
          expect(result.ok).toBe(false);
          expect(result.error).toBe(`MCP server '${BUN_DOCS_SERVER}' is disabled`);
        });
      } finally {
        removePath(altHome, { recursive: true, force: true });
      }
    });

    test("resolves user-only stdio server from home mcp.json", async () => {
      const altHome = join(tmpdir(), `kimi-custom-${Bun.randomUUIDv7()}`);
      makeDir(join(altHome, ".kimi-code"), { recursive: true });
      try {
        await writeMcpJson(join(altHome, ".kimi-code", "mcp.json"), {
          mcpServers: {
            "custom-only": { command: "echo" },
          },
        });
        await withEnv({ HOME: tmpHome }, async () => {
          const result = await callMcpTool("custom-only", "tool", {}, altHome);
          expect(result.ok).toBe(false);
          expect(result.error).toBe(
            "MCP server 'custom-only' is not an HTTP/SSE server (missing url)"
          );
        });
      } finally {
        removePath(altHome, { recursive: true, force: true });
      }
    });

    test("validates merged requiredEnv from user mcp.json", async () => {
      const altHome = join(tmpdir(), `kimi-env-${Bun.randomUUIDv7()}`);
      makeDir(join(altHome, ".kimi-code"), { recursive: true });
      try {
        await writeMcpJson(join(altHome, ".kimi-code", "mcp.json"), {
          mcpServers: {
            "needs-token": {
              url: "https://example.com/mcp",
              requiredEnv: ["CUSTOM_MCP_TOKEN"],
            },
          },
        });
        await withEnv({ HOME: tmpHome, CUSTOM_MCP_TOKEN: undefined }, async () => {
          const result = await callMcpTool("needs-token", "tool", {}, altHome);
          expect(result.ok).toBe(false);
          expect(result.error).toBe("missing env: CUSTOM_MCP_TOKEN");
        });
      } finally {
        removePath(altHome, { recursive: true, force: true });
      }
    });

    test("uses MCP_DEFAULTS.callTimeoutMs when no timeout is provided", () => {
      expect(typeof MCP_DEFAULTS.callTimeoutMs).toBe("number");
      expect(MCP_DEFAULTS.callTimeoutMs).toBeGreaterThan(0);
      expect(typeof MCP_DEFAULTS.queryTimeoutMs).toBe("number");
      expect(typeof MCP_DEFAULTS.cardTimeoutMs).toBe("number");
      expect(typeof MCP_DEFAULTS.maxTop).toBe("number");
    });
  });
});
