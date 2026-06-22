import { describe, expect, test } from "bun:test";
import { REPO_ROOT } from "./helpers.ts";
import {
  auditTemplateBunNative,
  auditTemplateEnvHygiene,
  auditTemplateInstallPolicy,
  auditTemplateModuleSlice,
  auditTemplateOxlint,
  auditTemplatePolicy,
  auditTemplateReadmeRegistry,
  auditTemplateScaffoldFiles,
  auditTemplateScaffoldMarkers,
  auditTemplateScaffoldToolchain,
  auditTemplateTestConventions,
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

  test("auditTemplateScaffoldFiles passes on repo templates", async () => {
    const violations = await auditTemplateScaffoldFiles(REPO_ROOT);
    expect(violations).toEqual([]);
  });

  test("auditTemplateScaffoldMarkers passes on repo templates", async () => {
    const violations = await auditTemplateScaffoldMarkers(REPO_ROOT);
    expect(violations).toEqual([]);
  });

  test("auditTemplateEnvHygiene passes on repo templates", async () => {
    const violations = await auditTemplateEnvHygiene(REPO_ROOT);
    expect(violations).toEqual([]);
  });

  test("auditTemplateTestConventions passes on repo templates", async () => {
    const violations = await auditTemplateTestConventions(REPO_ROOT);
    expect(violations).toEqual([]);
  });

  test("auditTemplateScaffoldToolchain passes on repo templates", async () => {
    const violations = await auditTemplateScaffoldToolchain(REPO_ROOT);
    expect(violations).toEqual([]);
  });

  test("auditTemplateReadmeRegistry passes on repo templates", async () => {
    const violations = await auditTemplateReadmeRegistry(REPO_ROOT);
    expect(violations).toEqual([]);
  });

  test("auditTemplateModuleSlice passes on repo templates", async () => {
    const violations = await auditTemplateModuleSlice(REPO_ROOT);
    expect(violations).toEqual([]);
  });

  test("auditTemplateOxlint passes on repo templates", async () => {
    const violations = await auditTemplateOxlint(REPO_ROOT);
    expect(violations).toEqual([]);
  });

  test("auditTemplatePolicy is clean end-to-end", async () => {
    const result = await auditTemplatePolicy(REPO_ROOT);
    if (result.violations.length > 0) {
      console.error(result.violations);
    }
    expect(result.violations).toEqual([]);
    expect(result.summary.tsconfigProjects).toBeGreaterThanOrEqual(4);
  }, 60_000);
});
