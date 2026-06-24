import { join } from "path";
import { describe, expect, test } from "bun:test";
import {
  buildBaselineFromViolations,
  defaultConfig,
  effectiveRuleMode,
  evaluateViolations,
  mergeConfig,
  scanFile,
  shouldFailCheck,
  violationKey,
  type BunNativeLintConfig,
  type Violation,
} from "../src/lib/bun-native-lint.ts";

function v(ruleId: string, file: string, line: number): Violation {
  return {
    ruleId,
    file,
    line,
    message: "test",
    snippet: "x",
    replacement: "y",
  };
}

const REPO_ROOT = join(import.meta.dir, "..");

describe("bun-native-lint", () => {
  test("enforce rules fail even when baselined", () => {
    const config = mergeConfig({
      rules: { "process-env": "enforce", "banned-import": "report" },
    });
    const violations = [v("process-env", "src/lib/a.ts", 1)];
    const baseline = {
      schemaVersion: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
      entries: [{ ruleId: "process-env", file: "src/lib/a.ts", line: 1, snippet: "x" }],
    };
    const result = evaluateViolations(violations, config, baseline);
    expect(result.enforceViolations).toHaveLength(1);
    expect(shouldFailCheck(result, config, "check")).toBe(true);
  });

  test("report rules allow baselined violations", () => {
    const config = defaultConfig();
    const violations = [v("process-env", "src/lib/a.ts", 2)];
    const baseline = {
      schemaVersion: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
      entries: [{ ruleId: "process-env", file: "src/lib/a.ts", line: 2, snippet: "x" }],
    };
    const result = evaluateViolations(violations, config, baseline);
    expect(result.newViolations).toHaveLength(0);
    expect(result.baselinedViolations).toHaveLength(1);
    expect(shouldFailCheck(result, config, "check")).toBe(false);
  });

  test("report rules fail on new violations", () => {
    const config = defaultConfig();
    const violations = [v("process-env", "src/lib/new.ts", 9)];
    const result = evaluateViolations(violations, config, null);
    expect(result.newViolations).toHaveLength(1);
    expect(shouldFailCheck(result, config, "check")).toBe(true);
  });

  test("update baseline for one rule preserves other entries", () => {
    const config = defaultConfig();
    const existing = {
      schemaVersion: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
      entries: [{ ruleId: "banned-import", file: "src/lib/old.ts", line: 3, snippet: "import fs" }],
    };
    const next = buildBaselineFromViolations(
      [v("process-env", "src/lib/a.ts", 1)],
      config,
      existing,
      "process-env"
    );
    expect(next.entries).toHaveLength(2);
    expect(next.entries.some((e) => e.ruleId === "banned-import")).toBe(true);
    expect(next.entries.some((e) => e.ruleId === "process-env")).toBe(true);
  });

  test("violationKey is stable", () => {
    expect(violationKey(v("process-env", "src/lib/a.ts", 4))).toBe("process-env::src/lib/a.ts::4");
  });

  test("engine source is not self-flagged for process-env", async () => {
    const rel = "src/lib/bun-native-lint.ts";
    const config = mergeConfig({
      rules: {
        "banned-import": "off",
        "banned-require": "off",
        "stringify-stdout": "off",
        "process-env": "enforce",
      },
    });
    const violations = await scanFile(REPO_ROOT, rel, config);
    expect(violations.some((v) => v.file === rel)).toBe(false);
  });

  test("block-comment content does not trigger violations", async () => {
    const dir = `${REPO_ROOT}/test/fixtures/bun-native-lint-block-comment`;
    await Bun.write(
      join(dir, "test.ts"),
      [
        "/*",
        "  process.env.SECRET is fine inside a block comment",
        '  import { readFileSync } from "fs" — also fine inside a comment',
        "*/",
        "const x = 1;",
        "console.log(x);",
      ].join("\n")
    );
    const config = mergeConfig({
      rules: {
        "process-env": "enforce",
        "banned-import": "enforce",
        "sync-fs-api": "enforce",
        "banned-require": "off",
      },
    });
    const violations = await scanFile(dir, "test.ts", config);
    // Clean up
    await Bun.write(join(dir, "test.ts"), "void 0;\n");
    expect(violations).toHaveLength(0);
  });

  test("line comment content does not trigger violations", async () => {
    const dir = `${REPO_ROOT}/test/fixtures/bun-native-lint-line-comment`;
    await Bun.write(
      join(dir, "test.ts"),
      [
        "// process.env.SECRET inline comment",
        "const a = 1;",
        '// import { readFileSync } from "fs"',
        "const b = 2;",
      ].join("\n")
    );
    const config = mergeConfig({
      rules: {
        "process-env": "enforce",
        "banned-import": "enforce",
        "sync-fs-api": "enforce",
      },
    });
    const violations = await scanFile(dir, "test.ts", config);
    await Bun.write(join(dir, "test.ts"), "void 0;\n");
    expect(violations).toHaveLength(0);
  });

  test("scoped exemption pragma only exempts named rule", async () => {
    const dir = `${REPO_ROOT}/test/fixtures/bun-native-lint-scoped-exempt`;
    await Bun.write(
      join(dir, "test.ts"),
      [
        "const secret = process.env.DB_PASS; // @bun-native-exempt:process-env",
        "",
        'const path = require("fs");',
      ].join("\n")
    );
    const config = mergeConfig({
      rules: {
        "process-env": "enforce",
        "banned-require": "enforce",
      },
    });
    const violations = await scanFile(dir, "test.ts", config);
    await Bun.write(join(dir, "test.ts"), "void 0;\n");

    // process.env line should be exempt (scoped pragma on same line)
    const processEnvViolations = violations.filter(
      (v) => v.ruleId === "process-env" && v.line === 1
    );
    expect(processEnvViolations).toHaveLength(0);

    // require("fs") should still be caught (no exemption on line 3)
    const requireViolations = violations.filter(
      (v) => v.ruleId === "banned-require" && v.line === 3
    );
    expect(requireViolations).toHaveLength(1);
  });

  test("unscoped @bun-native-exempt exempts all rules on that line", async () => {
    const dir = `${REPO_ROOT}/test/fixtures/bun-native-lint-unscoped-exempt`;
    await Bun.write(
      join(dir, "test.ts"),
      [
        'const secret = process.env.DB_PASS; const path = require("fs"); // @bun-native-exempt',
      ].join("\n")
    );
    const config = mergeConfig({
      rules: {
        "process-env": "enforce",
        "banned-require": "enforce",
      },
    });
    const violations = await scanFile(dir, "test.ts", config);
    await Bun.write(join(dir, "test.ts"), "void 0;\n");
    // All violations on line 1 should be exempt by unscoped pragma
    expect(violations).toHaveLength(0);
  });

  test("scopeOverrides relax enforce to report for matching path prefix", () => {
    const config: BunNativeLintConfig = {
      schemaVersion: 1,
      gateMode: "check",
      rules: { "process-env": "enforce" },
      scopeOverrides: { "process-env": { "scripts/": "report", "src/lib/": "report" } },
    };

    // src/lib/ → overridden to report
    expect(effectiveRuleMode(config, "process-env", "src/lib/a.ts")).toBe("report");
    // scripts/ → overridden to report
    expect(effectiveRuleMode(config, "process-env", "scripts/build.ts")).toBe("report");
    // src/bin/ → no override, stays enforce
    expect(effectiveRuleMode(config, "process-env", "src/bin/tool.ts")).toBe("enforce");
  });

  test("scopeOverrides longest prefix wins", () => {
    const config: BunNativeLintConfig = {
      schemaVersion: 1,
      gateMode: "check",
      rules: { "sync-fs-api": "enforce" },
      scopeOverrides: {
        "sync-fs-api": { "src/": "report", "src/lib/": "off" },
      },
    };

    // src/lib/ → longest match "src/lib/" → off
    expect(effectiveRuleMode(config, "sync-fs-api", "src/lib/io.ts")).toBe("off");
    // src/bin/ → matches "src/" but not "src/lib/" → report
    expect(effectiveRuleMode(config, "sync-fs-api", "src/bin/tool.ts")).toBe("report");
  });

  test("scopeOverrides cannot turn on an off rule", () => {
    const config: BunNativeLintConfig = {
      schemaVersion: 1,
      gateMode: "check",
      rules: { "buffer-from": "off" },
      scopeOverrides: {
        "buffer-from": { "src/": "enforce" },
      },
    };

    // Rule is off base, override cannot turn it on
    expect(effectiveRuleMode(config, "buffer-from", "src/lib/a.ts")).toBe("off");
  });

  test("scopeOverrides in evaluateViolations", () => {
    const config: BunNativeLintConfig = {
      schemaVersion: 1,
      gateMode: "check",
      rules: { "process-env": "enforce", "sync-fs-api": "enforce" },
      scopeOverrides: { "process-env": { "scripts/": "report" } },
    };
    const violations = [
      v("process-env", "scripts/build.ts", 1),
      v("sync-fs-api", "scripts/build.ts", 2),
    ];
    const result = evaluateViolations(violations, config, null);

    // process-env in scripts/ is overridden to report → new violation (no baseline)
    expect(result.newViolations.some((x) => x.ruleId === "process-env")).toBe(true);
    // sync-fs-api has no override for scripts/ → enforce violation
    expect(result.enforceViolations.some((x) => x.ruleId === "sync-fs-api")).toBe(true);
  });

  test("soft-banned-import detects advisory imports", async () => {
    const dir = `${REPO_ROOT}/test/fixtures/bun-native-lint-soft-import`;
    await Bun.write(
      join(dir, "test.ts"),
      [
        'import { join } from "path";',
        'import { homedir } from "os";',
        'import { inspect } from "util";',
        'import { Buffer } from "buffer";',
        "",
        'const p = join("/a", "b");',
      ].join("\n")
    );
    const config = mergeConfig({
      rules: {
        "soft-banned-import": "enforce",
      },
    });
    const violations = await scanFile(dir, "test.ts", config);
    await Bun.write(join(dir, "test.ts"), "void 0;\n");

    const softViolations = violations.filter((v) => v.ruleId === "soft-banned-import");
    expect(softViolations).toHaveLength(4);
    expect(softViolations.some((v) => v.message.includes("path"))).toBe(true);
    expect(softViolations.some((v) => v.message.includes("os"))).toBe(true);
    expect(softViolations.some((v) => v.message.includes("util"))).toBe(true);
    expect(softViolations.some((v) => v.message.includes("buffer"))).toBe(true);
  });

  test("shell-template-opportunity detects sh -c spawns", async () => {
    const dir = `${REPO_ROOT}/test/fixtures/bun-native-lint-shell-tmpl`;
    await Bun.write(
      join(dir, "test.ts"),
      ['const result = Bun.spawnSync(["sh", "-c", "echo hello"]);'].join("\n")
    );
    const config = mergeConfig({
      rules: {
        "shell-template-opportunity": "enforce",
      },
    });
    const violations = await scanFile(dir, "test.ts", config);
    await Bun.write(join(dir, "test.ts"), "void 0;\n");

    const shellV = violations.filter((v) => v.ruleId === "shell-template-opportunity");
    expect(shellV).toHaveLength(1);
  });

  test("buffer-from detects Buffer.from allocations", async () => {
    const dir = `${REPO_ROOT}/test/fixtures/bun-native-lint-buffer-from`;
    await Bun.write(
      join(dir, "test.ts"),
      ['const buf = Buffer.from("hello");', "const buf2 = Buffer.from([1, 2, 3]);"].join("\n")
    );
    const config = mergeConfig({
      rules: {
        "buffer-from": "enforce",
      },
    });
    const violations = await scanFile(dir, "test.ts", config);
    await Bun.write(join(dir, "test.ts"), "void 0;\n");

    expect(violations.filter((v) => v.ruleId === "buffer-from")).toHaveLength(2);
  });
});
