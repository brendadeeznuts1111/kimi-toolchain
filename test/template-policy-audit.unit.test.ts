import { describe, expect, test } from "bun:test";
import { REPO_ROOT } from "./helpers.ts";
import {
  auditTemplateBunNative,
  auditTemplateInstallPolicy,
  auditTemplatePolicy,
  auditTemplateTsconfigs,
  templateBunNativeConfig,
} from "../src/lib/template-policy-audit.ts";

describe("template-policy-audit", () => {
  test("templateBunNativeConfig enforces core rules", () => {
    const config = templateBunNativeConfig();
    expect(config.rules["process-env"]).toBe("enforce");
    expect(config.rules["banned-import"]).toBe("enforce");
  });

  test("auditTemplateInstallPolicy passes on repo templates", async () => {
    const violations = await auditTemplateInstallPolicy(REPO_ROOT);
    expect(violations).toEqual([]);
  });

  test("auditTemplateTsconfigs passes on repo templates", async () => {
    const violations = await auditTemplateTsconfigs(REPO_ROOT);
    expect(violations).toEqual([]);
  });

  test("auditTemplateBunNative passes on repo templates", async () => {
    const violations = await auditTemplateBunNative(REPO_ROOT);
    expect(violations).toEqual([]);
  });

  test(
    "auditTemplatePolicy is clean end-to-end",
    async () => {
      const result = await auditTemplatePolicy(REPO_ROOT);
      if (result.violations.length > 0) {
        console.error(result.violations);
      }
      expect(result.violations).toEqual([]);
      expect(result.summary.tsconfigProjects).toBeGreaterThanOrEqual(4);
    },
    60_000
  );
});
