import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import {
  buildUnifiedShellEntry,
  mergeUnifiedShellServer,
  provisionUserMcp,
  readMcpJson,
  UNIFIED_SHELL_SERVER,
  userMcpPath,
  writeMcpJson,
} from "../src/lib/mcp-config.ts";

const REPO_ROOT = join(import.meta.dir, "..");
let tmpHome: string;

describe("mcp-config", () => {
  beforeEach(async () => {
    tmpHome = join(REPO_ROOT, `.tmp-mcp-${Date.now()}`);
    mkdirSync(tmpHome, { recursive: true });
    mkdirSync(join(tmpHome, ".kimi-code", "tools"), { recursive: true });
    await Bun.write(
      join(tmpHome, ".kimi-code", "tools", "unified-shell-bridge.ts"),
      "// bridge stub\n"
    );
  });

  afterEach(() => {
    if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  });

  test("buildUnifiedShellEntry uses absolute bun and bridge path", () => {
    const entry = buildUnifiedShellEntry(tmpHome);
    expect(entry.command).toBeTruthy();
    expect(entry.args?.join(" ")).toContain("unified-shell-bridge.ts");
    expect(entry.env?.KIMI_SHELL_MODE).toBe("unified");
  });

  test("mergeUnifiedShellServer adds unified-shell without removing others", () => {
    const existing = {
      mcpServers: {
        other: { url: "https://example.com/mcp" },
      },
    };
    const { config, changed } = mergeUnifiedShellServer(existing, tmpHome);
    expect(changed).toBe(true);
    expect(config.mcpServers.other?.url).toBe("https://example.com/mcp");
    expect(config.mcpServers[UNIFIED_SHELL_SERVER]).toBeDefined();
  });

  test("mergeUnifiedShellServer is idempotent when entry matches", () => {
    const { config: first } = mergeUnifiedShellServer(null, tmpHome);
    const { config: second, changed } = mergeUnifiedShellServer(first, tmpHome);
    expect(second.mcpServers[UNIFIED_SHELL_SERVER]?.command).toBe(
      first.mcpServers[UNIFIED_SHELL_SERVER]?.command
    );
    expect(changed).toBe(false);
  });

  test("provisionUserMcp creates mcp.json", async () => {
    const path = userMcpPath(tmpHome);
    expect(existsSync(path)).toBe(false);
    const result = await provisionUserMcp(tmpHome);
    expect(result.changed).toBe(true);
    expect(existsSync(path)).toBe(true);
    const parsed = await readMcpJson(path);
    expect(parsed?.mcpServers[UNIFIED_SHELL_SERVER]).toBeDefined();
  });

  test("writeMcpJson round-trips", async () => {
    const path = join(tmpHome, "mcp-test.json");
    const data = { mcpServers: { test: { command: "echo" } } };
    await writeMcpJson(path, data);
    const read = await readMcpJson(path);
    expect(read?.mcpServers.test?.command).toBe("echo");
  });
});
