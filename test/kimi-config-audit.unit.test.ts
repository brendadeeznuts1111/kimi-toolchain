import { describe, expect, test } from "bun:test";
import {
  allowsUnifiedShellMcp,
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
});
