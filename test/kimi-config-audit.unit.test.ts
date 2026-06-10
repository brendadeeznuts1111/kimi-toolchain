import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  allowsUnifiedShellMcp,
  mergeConfigTomlPermissions,
  parseDefaultPermissionMode,
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
      mkdirSync(join(home, ".kimi-code"), { recursive: true });
    });

    afterEach(() => {
      if (existsSync(home)) rmSync(home, { recursive: true, force: true });
    });

    test("creates config.toml with snippet when missing", async () => {
      const result = await mergeConfigTomlPermissions(home);
      expect(result.created).toBe(true);
      expect(existsSync(result.path)).toBe(true);
      const text = await Bun.file(result.path).text();
      expect(text).toContain("mcp__unified-shell__execute");
    });

    test("is idempotent when snippet already present", async () => {
      await mergeConfigTomlPermissions(home);
      const second = await mergeConfigTomlPermissions(home);
      expect(second.merged).toBe(false);
    });
  });
});
