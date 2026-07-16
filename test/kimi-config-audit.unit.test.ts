import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { tmpdir } from "os";
import { testTempDir, makeDir, pathExists, removePath } from "./helpers.ts";
import {
  allowsUnifiedShellMcp,
  auditHookFiles,
  auditKimiConfig,
  mergeConfigTomlHooks,
  mergeConfigTomlPermissions,
  parseDefaultPermissionMode,
  parseHookCommands,
  parsePermissionRules,
} from "../src/lib/kimi-config-audit.ts";

describe("kimi-config-audit", () => {
  test("parsePermissionRules extracts decision and pattern", () => {
    const text = `
default_permission_mode = "manual"
[[permission.rules]]
decision = "allow"
pattern = "Read"

[[permission.rules]]
decision = "allow"
pattern = "mcp__unified-shell__execute"
`;
    const rules = parsePermissionRules(text);
    expect(rules).toHaveLength(2);
    expect(rules[1]?.pattern).toBe("mcp__unified-shell__execute");
  });

  test("parseDefaultPermissionMode reads mode", () => {
    expect(parseDefaultPermissionMode('default_permission_mode = "yolo"')).toBe("yolo");
    expect(parseDefaultPermissionMode("[loop_control]")).toBe("manual");
  });

  test("allowsUnifiedShellMcp matches tool and wildcard", () => {
    expect(
      allowsUnifiedShellMcp([{ decision: "allow", pattern: "mcp__unified-shell__execute" }])
    ).toBe(true);
    expect(allowsUnifiedShellMcp([{ decision: "allow", pattern: "mcp__unified-shell__*" }])).toBe(
      true
    );
    expect(
      allowsUnifiedShellMcp([{ decision: "deny", pattern: "mcp__unified-shell__execute" }])
    ).toBe(false);
  });

  describe("mergeConfigTomlPermissions", () => {
    let home: string;

    beforeEach(() => {
      home = join(tmpdir(), `kimi-config-merge-${Bun.randomUUIDv7()}`);
      makeDir(join(home, ".kimi-code"), { recursive: true });
    });

    afterEach(() => {
      if (pathExists(home)) removePath(home, { recursive: true, force: true });
    });

    test("creates config.toml with snippet when missing", async () => {
      const result = await mergeConfigTomlPermissions(home);
      expect(result.created).toBe(true);
      expect(pathExists(result.path)).toBe(true);
      const text = await Bun.file(result.path).text();
      expect(text).toContain("mcp__unified-shell__execute");
    });

    test("is idempotent when snippet already present", async () => {
      await mergeConfigTomlPermissions(home);
      const second = await mergeConfigTomlPermissions(home);
      expect(second.merged).toBe(false);
    });
  });

  describe("mergeConfigTomlHooks", () => {
    let home: string;

    beforeEach(() => {
      home = join(tmpdir(), `kimi-config-hooks-${Bun.randomUUIDv7()}`);
      makeDir(join(home, ".kimi-code"), { recursive: true });
    });

    afterEach(() => {
      if (pathExists(home)) removePath(home, { recursive: true, force: true });
    });

    test("creates config.toml with PostToolUseFailure hook", async () => {
      const result = await mergeConfigTomlHooks(home);
      expect(result.created).toBe(true);
      const text = await Bun.file(result.path).text();
      expect(text).toContain("PostToolUseFailure");
      expect(text).toContain("log-tool-failure.ts");
    });

    test("is idempotent when hook already present", async () => {
      await mergeConfigTomlHooks(home);
      const second = await mergeConfigTomlHooks(home);
      expect(second.merged).toBe(false);
    });
  });

  describe("auditKimiConfig failure-hook check", () => {
    let home: string;

    beforeEach(() => {
      home = join(tmpdir(), `kimi-config-audit-hooks-${Bun.randomUUIDv7()}`);
      makeDir(join(home, ".kimi-code"), { recursive: true });
    });

    afterEach(() => {
      if (pathExists(home)) removePath(home, { recursive: true, force: true });
    });

    test("warns when PostToolUseFailure hook is missing", async () => {
      await Bun.write(
        join(home, ".kimi-code", "config.toml"),
        'default_permission_mode = "manual"\n'
      );
      const checks = await auditKimiConfig(home);
      const hookCheck = checks.find((c) => c.name === "failure-hook");
      expect(hookCheck?.status).toBe("warn");
      expect(hookCheck?.fixable).toBe(true);
    });

    test("ok when PostToolUseFailure hook is present", async () => {
      await mergeConfigTomlHooks(home);
      const checks = await auditKimiConfig(home);
      const hookCheck = checks.find((c) => c.name === "failure-hook");
      expect(hookCheck?.status).toBe("ok");
    });
  });

  describe("parseHookCommands", () => {
    test("extracts bun run and bash hook commands", () => {
      const text = `
[[hooks]]
event = "PostToolUseFailure"
command = "bun run /home/user/.kimi-code/kimi-hooks/log-tool-failure.ts"
timeout = 10

[[hooks]]
event = "SessionStart"
command = "bash '/home/user/.kimi-code/hooks/herdr-agent-state.sh' session"
`;
      expect(parseHookCommands(text)).toEqual([
        "bun run /home/user/.kimi-code/kimi-hooks/log-tool-failure.ts",
        "bash '/home/user/.kimi-code/hooks/herdr-agent-state.sh' session",
      ]);
    });

    test("returns empty array when no hooks", () => {
      expect(parseHookCommands('default_permission_mode = "manual"')).toEqual([]);
    });
  });

  describe("auditHookFiles", () => {
    test("reports missing hook scripts", () => {
      const text = `
[[hooks]]
event = "PostToolUseFailure"
command = "bun run /missing/path/hook.ts"
`;
      const result = auditHookFiles(text);
      expect(result.checked).toBe(1);
      expect(result.missing).toEqual(["/missing/path/hook.ts"]);
    });

    test("returns empty missing list when inline bash script is used", () => {
      const text = `
[[hooks]]
event = "PreToolUse"
command = "bash -c 'echo hello'"
`;
      const result = auditHookFiles(text);
      expect(result.checked).toBe(0);
      expect(result.missing).toEqual([]);
    });
  });

  describe("auditKimiConfig hook-files check", () => {
    test("ok when configured hook files exist", async () => {
      const home = testTempDir("kimi-config-audit-hook-files-ok");
      makeDir(join(home, ".kimi-code", "hooks"), { recursive: true });
      await Bun.write(join(home, ".kimi-code", "hooks", "state.sh"), "#!/bin/sh\n");
      await Bun.write(
        join(home, ".kimi-code", "config.toml"),
        `
default_permission_mode = "manual"

[[hooks]]
event = "SessionStart"
command = "bash '${home}/.kimi-code/hooks/state.sh' session"
timeout = 10
`
      );
      const checks = await auditKimiConfig(home, { unifiedShellRegistered: false });
      const hookFiles = checks.find((c) => c.name === "hook-files");
      expect(hookFiles?.status).toBe("ok");
      expect(hookFiles?.message).toContain("1 configured hook script(s) present");
      removePath(home, { recursive: true, force: true });
    });

    test("warns when configured hook files are missing", async () => {
      const home = testTempDir("kimi-config-audit-hook-files-missing");
      await Bun.write(
        join(home, ".kimi-code", "config.toml"),
        `
default_permission_mode = "manual"

[[hooks]]
event = "SessionStart"
command = "bash '${home}/.kimi-code/hooks/missing.sh' session"
timeout = 10
`
      );
      const checks = await auditKimiConfig(home, { unifiedShellRegistered: false });
      const hookFiles = checks.find((c) => c.name === "hook-files");
      expect(hookFiles?.status).toBe("warn");
      expect(hookFiles?.message).toContain("missing");
      removePath(home, { recursive: true, force: true });
    });
  });
});
