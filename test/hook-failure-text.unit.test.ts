import { describe, expect, test } from "bun:test";
import {
  extractHookFailureText,
  isAgentRuntimeToolName,
  isManagedLedgerFailure,
} from "../src/lib/hook-failure-text.ts";

describe("hook-failure-text", () => {
  test("extractHookFailureText prefers string error", () => {
    expect(extractHookFailureText({ error: "command not found: foo" })).toBe(
      "command not found: foo"
    );
  });

  test("extractHookFailureText stringifies object error message", () => {
    expect(extractHookFailureText({ error: { message: "Permission denied" } })).toBe(
      "Permission denied"
    );
  });

  test("extractHookFailureText reads nested reason from object errors", () => {
    expect(extractHookFailureText({ error: { code: 1, reason: "timeout" } })).toBe("timeout");
  });

  test("extractHookFailureText falls back to tool_output", () => {
    expect(
      extractHookFailureText({
        tool_output: "error TS2345: type mismatch",
      })
    ).toBe("error TS2345: type mismatch");
  });

  test("extractHookFailureText rejects bare [object Object]", () => {
    expect(extractHookFailureText({ error: "[object Object]" })).toBeNull();
  });

  test("isAgentRuntimeToolName identifies IDE tools", () => {
    expect(isAgentRuntimeToolName("Bash")).toBe(true);
    expect(isAgentRuntimeToolName("kimi-doctor")).toBe(false);
  });

  test("isManagedLedgerFailure excludes agent runtime tools", () => {
    expect(isManagedLedgerFailure({ toolName: "Read" })).toBe(false);
    expect(isManagedLedgerFailure({ toolName: "kimi-doctor" })).toBe(true);
    expect(isManagedLedgerFailure({ toolName: "scripts/check.ts" })).toBe(true);
  });
});
