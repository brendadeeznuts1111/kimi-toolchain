import { describe, expect, test } from "bun:test";
import {
  renderDxConfig,
  renderWorkspaceToml,
  resolveScaffoldProfile,
  filterScaffoldArgv,
  dxAgentsPath,
} from "../src/lib/scaffold-profiles.ts";
import { DX_CONFIG_APP, DX_CONFIG_TOOLCHAIN } from "../src/lib/scaffold-templates.ts";

describe("scaffold-profiles", () => {
  test("resolveScaffoldProfile defaults to app", () => {
    expect(resolveScaffoldProfile(["fix", "."])).toBe("app");
  });

  test("resolveScaffoldProfile reads --profile toolchain", () => {
    expect(resolveScaffoldProfile(["fix", ".", "--profile", "toolchain"])).toBe("toolchain");
    expect(resolveScaffoldProfile(["--profile=toolchain", "."])).toBe("toolchain");
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

  test("renderWorkspaceToml substitutes project name", () => {
    const rendered = renderWorkspaceToml("demo-app");
    expect(rendered).toContain("demo-app");
    expect(rendered).not.toContain("{{PROJECT_NAME}}");
  });

  test("dxAgentsPath joins home and dx agents file", () => {
    expect(dxAgentsPath("/tmp/home")).toBe("/tmp/home/.config/dx/AGENTS.md");
  });
});
