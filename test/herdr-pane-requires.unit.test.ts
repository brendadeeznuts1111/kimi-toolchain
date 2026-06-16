import { describe, expect, test } from "bun:test";
import {
  checkPaneRequirement,
  parsePaneRequirement,
  verifyPaneRequirements,
} from "../src/lib/herdr-pane-requires.ts";

describe("herdr-pane-requires", () => {
  test("parsePaneRequirement accepts string and object forms", () => {
    expect(parsePaneRequirement("git")?.bin).toBe("git");
    expect(
      parsePaneRequirement({ bin: "kimi-doctor", package: "kimi-doctor", install: "bun add -g x" })
        ?.package
    ).toBe("kimi-doctor");
  });

  test("checkPaneRequirement resolves PATH binaries", () => {
    const check = checkPaneRequirement({ bin: "git" });
    expect(check.ok).toBe(Boolean(Bun.which("git")));
    if (check.ok) expect(check.via).toBe("path");
  });

  test("verifyPaneRequirements reports missing tools", () => {
    const result = verifyPaneRequirements([
      "git",
      { bin: "definitely-not-a-real-binary-xyz", install: "nope" },
    ]);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("definitely-not-a-real-binary-xyz");
  });
});
