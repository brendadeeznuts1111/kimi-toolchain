import { describe, expect, test } from "bun:test";
import { getHelpText, coloredBuildSummary } from "../src/lib/cli-help-generator.ts";

// ── CLI Help Generator Tests ─────────────────────────────────────────

describe("cli-help-generator > kimi-secrets help", () => {
  const help = getHelpText("kimi-secrets");

  test("contains tool name", () => {
    expect(help).toContain("kimi-secrets");
  });

  test("contains all commands", () => {
    expect(help).toContain("check");
    expect(help).toContain("list");
    expect(help).toContain("get");
    expect(help).toContain("set");
    expect(help).toContain("rotate");
    expect(help).toContain("delete");
    expect(help).toContain("audit");
    expect(help).toContain("init");
  });

  test("contains options", () => {
    expect(help).toContain("--json");
    expect(help).toContain("--unmask");
    expect(help).toContain("--project");
  });

  test("contains examples", () => {
    expect(help).toContain("kimi-secrets check");
    expect(help).toContain("kimi-secrets list --json");
  });

  test("contains build info", () => {
    expect(help).toMatch(/v\d+\.\d+\.\d+/);
    expect(help).toContain("Build:");
  });
});

describe("cli-help-generator > kimi-guardian help", () => {
  const help = getHelpText("kimi-guardian");

  test("contains tool name", () => {
    expect(help).toContain("kimi-guardian");
  });

  test("contains all commands", () => {
    expect(help).toContain("check");
    expect(help).toContain("fix");
    expect(help).toContain("sign");
    expect(help).toContain("verify");
    expect(help).toContain("report");
    expect(help).toContain("doctor");
  });

  test("contains examples", () => {
    expect(help).toContain("kimi-guardian check");
    expect(help).toContain("kimi-guardian report --json");
  });
});

describe("cli-help-generator > general help", () => {
  const help = getHelpText("general");

  test("contains all tool names", () => {
    expect(help).toContain("kimi-secrets");
    expect(help).toContain("kimi-guardian");
    expect(help).toContain("install-secure");
  });

  test("contains table of contents", () => {
    expect(help).toContain("Table of Contents:");
    expect(help).toMatch(/\d+\./);
  });

  test("contains install guide from embedded docs", () => {
    expect(help).toContain("Install Guide:");
    expect(help).toContain("bun install");
  });
});

describe("cli-help-generator > coloredBuildSummary", () => {
  test("contains version and git hash", () => {
    const summary = coloredBuildSummary();
    // Strip ANSI codes for content check
    const stripped = summary.replace(/\x1b\[[0-9;]*m/g, "");
    expect(stripped).toMatch(/v\d+\.\d+\.\d+/);
    expect(stripped).toContain("(");
  });

  test("contains ANSI color codes", () => {
    const summary = coloredBuildSummary();
    expect(summary).toMatch(/\x1b\[/);
  });
});
