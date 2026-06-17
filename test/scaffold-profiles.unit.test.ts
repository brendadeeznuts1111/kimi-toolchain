import { makeDir, pathExists, removePath, writeText } from "../src/lib/bun-io.ts";

import { describe, expect, test } from "bun:test";
import { testTempDir } from "./helpers.ts";
import {
  renderDxConfig,
  scaffoldDxConfigTemplateRel,
  resolveScaffoldProfile,
  filterScaffoldArgv,
  dxAgentsPath,
  detectProfileDrift,
  ScaffoldProfileError,
} from "../src/lib/scaffold-profiles.ts";
import { join } from "path";
import { DX_CONFIG_APP, DX_CONFIG_TOOLCHAIN } from "../src/lib/scaffold-templates.ts";

describe("scaffold-profiles", () => {
  test("resolveScaffoldProfile defaults to app", () => {
    expect(resolveScaffoldProfile(["fix", "."])).toBe("app");
  });

  test("resolveScaffoldProfile reads --profile toolchain", () => {
    expect(resolveScaffoldProfile(["fix", ".", "--profile", "toolchain"])).toBe("toolchain");
    expect(resolveScaffoldProfile(["--profile=toolchain", "."])).toBe("toolchain");
  });

  test("resolveScaffoldProfile rejects unknown profile", () => {
    expect(() => resolveScaffoldProfile([".", "--profile", "foo"])).toThrow(ScaffoldProfileError);
    expect(() => resolveScaffoldProfile(["--profile=foo"])).toThrow(ScaffoldProfileError);
  });

  test("resolveScaffoldProfile rejects --profile without value", () => {
    expect(() => resolveScaffoldProfile([".", "--profile", "--dry-run"])).toThrow(
      ScaffoldProfileError
    );
    expect(() => resolveScaffoldProfile([".", "--profile"])).toThrow(ScaffoldProfileError);
  });

  test("scaffoldDxConfigTemplateRel maps profiles to template files", () => {
    expect(scaffoldDxConfigTemplateRel("app")).toBe("dx.config.app.toml");
    expect(scaffoldDxConfigTemplateRel("toolchain")).toBe("dx.config.toolchain.toml");
  });

  test("filterScaffoldArgv removes profile flags", () => {
    expect(filterScaffoldArgv(["fix", ".", "--profile", "toolchain", "--dry-run"])).toEqual([
      "fix",
      ".",
      "--dry-run",
    ]);
  });

  test("renderDxConfig substitutes project name and dx agents path", () => {
    const rendered = renderDxConfig("toolchain", "demo-app", "/tmp/home");
    expect(rendered).toContain('workspaceLabel = "demo-app"');
    expect(rendered).toContain('firstRead = ["/tmp/home/.config/dx/AGENTS.md"');
    expect(rendered).toContain("[finishWork]");
    expect(rendered).toContain("[herdr]");
    expect(rendered).not.toContain("{{PROJECT_NAME}}");
  });

  test("app template excludes sync and ci.local blocks", () => {
    expect(DX_CONFIG_APP).not.toContain("[sync]");
    expect(DX_CONFIG_APP).not.toContain("[github.ci.local]");
    expect(DX_CONFIG_APP).not.toContain("test:smoke");
  });

  test("toolchain template includes finish-work and herdr", () => {
    expect(DX_CONFIG_TOOLCHAIN).toContain("[finishWork]");
    expect(DX_CONFIG_TOOLCHAIN).toContain("[herdr]");
    expect(DX_CONFIG_TOOLCHAIN).not.toContain("[sync]");
  });

  test("toolchain renderDxConfig documents herdr layout in comments", () => {
    const rendered = renderDxConfig("toolchain", "demo-app", "/tmp/home");
    expect(rendered).toContain("single source of truth");
    expect(rendered).toContain("[[herdr.tabs]]");
  });

  test("dxAgentsPath joins home and dx agents file", () => {
    expect(dxAgentsPath("/tmp/home")).toBe("/tmp/home/.config/dx/AGENTS.md");
  });

  test("detectProfileDrift warns when toolchain files missing", () => {
    const root = testTempDir("scaffold-drift-");
    makeDir(root, { recursive: true });
    writeText(join(root, "dx.config.toml"), "[kimi]\n");
    try {
      expect(detectProfileDrift(root, "toolchain")).toContain("scripts/finish-work.ts");
    } finally {
      removePath(root, { recursive: true, force: true });
    }
  });

  test("detectProfileDrift returns null for fresh app scaffold", () => {
    const root = testTempDir("scaffold-drift-");
    makeDir(root, { recursive: true });
    try {
      expect(detectProfileDrift(root, "app")).toBeNull();
      expect(pathExists(join(root, "dx.config.toml"))).toBe(false);
    } finally {
      removePath(root, { recursive: true, force: true });
    }
  });
});
