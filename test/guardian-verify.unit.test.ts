import { describe, expect, it } from "bun:test";
import { evaluateGuardianVerifyOutput } from "../src/guardian/verify.ts";

describe("guardian-verify", () => {
  it("returns success for clean output", () => {
    const result = evaluateGuardianVerifyOutput("✓ Lockfile hash matches\n", false);
    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual(["✓ Lockfile integrity verified"]);
  });

  it("returns fix hint for HASH MISMATCH (advisory)", () => {
    const result = evaluateGuardianVerifyOutput("✗ HASH MISMATCH\n", false);
    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual(["Run 'kimi-guardian fix' to baseline the hash"]);
  });

  it("returns fix hint for No stored hash (advisory)", () => {
    const result = evaluateGuardianVerifyOutput("No stored hash — run fix\n", false);
    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual(["Run 'kimi-guardian fix' to baseline the hash"]);
  });

  it("returns fix and sign hints when signed manifest is missing", () => {
    const result = evaluateGuardianVerifyOutput(
      "✗ HASH MISMATCH\nNo signed manifest — run sign\n",
      false
    );
    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual([
      "Run 'kimi-guardian fix' to baseline the hash",
      "Run 'kimi-guardian sign' for v2 signed manifest protection",
    ]);
  });

  it("exits non-zero when exitOnFail is true", () => {
    const result = evaluateGuardianVerifyOutput("✗ HASH MISMATCH\n", true);
    expect(result.exitCode).toBe(2);
    expect(result.lines).toEqual(["Run 'kimi-guardian fix' to baseline the hash"]);
  });
});
