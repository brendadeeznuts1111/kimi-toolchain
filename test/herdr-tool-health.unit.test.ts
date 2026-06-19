import { makeDir, removePath, writeText } from "../src/lib/bun-io.ts";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "path";
import { auditHerdrToolHealth, detectHerdrToolDrift } from "../src/lib/herdr-tool-health.ts";

import { testTempDir } from "./helpers.ts";
describe("herdr-tool-health", () => {
  let home: string;
  let repoRoot: string;

  beforeEach(() => {
    home = testTempDir("herdr-tool-health-");
    repoRoot = join(home, "kimi-toolchain");
    makeDir(join(home, ".local", "bin"), { recursive: true });
    makeDir(join(home, ".kimi-code", "tools"), { recursive: true });
    makeDir(join(repoRoot, "src", "bin"), { recursive: true });
    for (const name of ["herdr-doctor", "herdr-latm", "herdr-project", "herdr-spawn"]) {
      writeText(join(repoRoot, "src", "bin", `${name}.ts`), `export const ${name} = 1;\n`);
    }
    writeText(
      join(home, ".kimi-code", "tools", "herdr-doctor.ts"),
      "export const herdr-doctor = 1;\n"
    );
    writeText(join(home, ".local", "bin", "herdr-doctor"), "#!/bin/sh\necho doctor\n");
  });

  afterEach(() => {
    removePath(home, { recursive: true, force: true });
  });

  test("detectHerdrToolDrift reports missing desktop tools", async () => {
    const drift = await detectHerdrToolDrift(repoRoot, home);
    expect(drift.missingDesktop).toContain("herdr-project");
    expect(drift.missingDesktop).toContain("herdr-spawn");
    expect(drift.drifted).not.toContain("herdr-doctor");
  });

  test("auditHerdrToolHealth includes fixPlan when drift present", async () => {
    const report = await auditHerdrToolHealth(repoRoot, home);
    expect(report.checks.some((c) => c.name === "herdr-tools:desktop-sync")).toBe(true);
    expect(report.checks.some((c) => c.name === "herdr-tools:wrappers")).toBe(true);
    expect(report.fixPlan.some((s) => s.includes("sync") || s.includes("install-wrappers"))).toBe(
      true
    );
  });

  test("auditHerdrToolHealth ok when desktop and wrappers fully installed", async () => {
    for (const name of ["herdr-latm", "herdr-project", "herdr-spawn"]) {
      const text = await Bun.file(join(repoRoot, "src", "bin", `${name}.ts`)).text();
      writeText(join(home, ".kimi-code", "tools", `${name}.ts`), text);
      writeText(join(home, ".local", "bin", name), "#!/bin/sh\necho stub\n");
    }
    for (const agent of ["codex", "kimi", "hermes", "grok", "claude"]) {
      writeText(join(home, ".local", "bin", `herdr-spawn-${agent}`), "#!/bin/sh\necho\n");
    }

    const report = await auditHerdrToolHealth(repoRoot, home);
    expect(report.checks.find((c) => c.name === "herdr-tools:desktop-sync")?.status).toBe("ok");
    expect(report.checks.find((c) => c.name === "herdr-tools:wrappers")?.status).toBe("ok");
    expect(report.checks.find((c) => c.name === "herdr-tools:spawn-stubs")?.status).toBe("ok");
    expect(report.fixPlan).toHaveLength(0);
  });
});
