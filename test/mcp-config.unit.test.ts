import { makeDir, pathExists, removePath } from "../src/lib/bun-io.ts";

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { testTempDir, withEnv } from "./helpers.ts";
import {
  buildCloudflareApiEntry,
  buildUnifiedShellEntry,
  CLOUDFLARE_API_SERVER,
  mergeToolchainMcpServers,
  mergeUnifiedShellServer,
  provisionUserMcp,
  readMcpJson,
  UNIFIED_SHELL_SERVER,
  userMcpPath,
  validateMcpConfig,
  writeMcpJson,
} from "../src/lib/mcp-config.ts";

let tmpHome: string;

describe("mcp-config", () => {
  beforeEach(async () => {
    tmpHome = testTempDir("kimi-mcp-");
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
    expect(changed).toBe(false);
  });

  test("mergeUnifiedShellServer is backward-compatible alias", () => {
    const { config, changed } = mergeUnifiedShellServer(null, tmpHome);
    expect(changed).toBe(true);
    expect(config.mcpServers[UNIFIED_SHELL_SERVER]).toBeDefined();
    expect(config.mcpServers[CLOUDFLARE_API_SERVER]).toBeDefined();
  });

  test("buildCloudflareApiEntry points to Cloudflare MCP URL", () => {
    const entry = buildCloudflareApiEntry();
    expect(entry.url).toBe("https://mcp.cloudflare.com/mcp");
  });

  test("provisionUserMcp creates mcp.json with both servers", async () => {
    await withEnv({ HOME: tmpHome }, async () => {
      const path = userMcpPath();
      if (pathExists(path)) removePath(path, { force: true });
      expect(pathExists(path)).toBe(false);
      const result = await provisionUserMcp(tmpHome);
      expect(result.changed).toBe(true);
      expect(pathExists(path)).toBe(true);
      const parsed = await readMcpJson(path);
      expect(parsed?.data?.mcpServers[UNIFIED_SHELL_SERVER]).toBeDefined();
      expect(parsed?.data?.mcpServers[CLOUDFLARE_API_SERVER]).toBeDefined();
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
    await withEnv({ HOME: tmpHome }, async () => {
      await provisionUserMcp(tmpHome);
      const report = await validateMcpConfig(tmpHome);
      const cfCheck = report.checks.find((c) => c.name === "cloudflare-api-mcp");
      expect(cfCheck?.status).toBe("ok");
      expect(cfCheck?.message).toContain("mcp.cloudflare.com");

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
});
