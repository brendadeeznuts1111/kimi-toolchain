import { makeDir, pathExists, removePath, writeText } from "../src/lib/bun-io.ts";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "path";
import { checkScaffold } from "../src/lib/scaffold-doctor.ts";
import { REQUIRED_PACKAGE_SCRIPT_ENTRIES } from "../src/lib/scaffold-templates.ts";

/** File check `name` values (the short names used in the check output). */
import { REPO_ROOT } from "./helpers.ts";
const EXPECTED_FILE_NAMES = [
  "AGENTS.md",
  "CODE_REFERENCES.md",
  "README.md",
  "tsconfig.json",
  "bunfig.toml",
  "dx.config.toml",
  "mcp.json",
  "index.ts",
  "check.ts",
  "oxfmtrc",
  "oxlintrc",
];

/** Mapping from check name → relative path (for touch). */
const FILE_PATHS: Record<string, string> = {
  "AGENTS.md": "AGENTS.md",
  "CODE_REFERENCES.md": "CODE_REFERENCES.md",
  "README.md": "README.md",
  "tsconfig.json": "tsconfig.json",
  "bunfig.toml": "bunfig.toml",
  "dx.config.toml": "dx.config.toml",
  "mcp.json": ".kimi-code/mcp.json",
  "index.ts": "src/index.ts",
  "check.ts": "scripts/check.ts",
  oxfmtrc: ".oxfmtrc.json",
  oxlintrc: ".oxlintrc.json",
};

function writeJson(path: string, data: unknown) {
  writeText(path, JSON.stringify(data, null, 2));
}

function touch(path: string) {
  makeDir(join(path, ".."), { recursive: true });
  writeText(path, "");
}

describe("scaffold-doctor", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(REPO_ROOT, `.tmp-test-scaffold-doctor-${Date.now()}`);
    makeDir(tmpDir, { recursive: true });
  });

  afterEach(() => {
    if (pathExists(tmpDir)) removePath(tmpDir, { recursive: true, force: true });
  });

  // ─── File presence checks ──────────────────────────────────────────────

  describe("file presence checks", () => {
    test("reports 'ok' for every file that exists", async () => {
      // Create all expected files
      for (const rel of Object.values(FILE_PATHS)) touch(join(tmpDir, rel));

      const checks = await checkScaffold(tmpDir);

      for (const name of EXPECTED_FILE_NAMES) {
        const c = checks.find((ch) => ch.name === name);
        expect(c, `file=${name}`).toBeDefined();
        expect(c!.status).toBe("ok");
        expect(c!.message).toBe("present");
        expect(c!.fixable).toBe(false);
      }
    });

    test("reports 'warn' for every file that is missing", async () => {
      const checks = await checkScaffold(tmpDir);

      for (const name of EXPECTED_FILE_NAMES) {
        const c = checks.find((ch) => ch.name === name);
        expect(c, `file=${name}`).toBeDefined();
        expect(c!.status).toBe("warn");
        expect(c!.message).toBe("missing — run kimi-fix");
        expect(c!.fixable).toBe(true);
      }
    });

    test("mixed presence — some present, some missing", async () => {
      // Only create the first 3 files
      for (const name of EXPECTED_FILE_NAMES.slice(0, 3)) touch(join(tmpDir, FILE_PATHS[name]));

      const checks = await checkScaffold(tmpDir);

      const present = EXPECTED_FILE_NAMES.slice(0, 3);
      const absent = EXPECTED_FILE_NAMES.slice(3);

      for (const name of present) {
        const c = checks.find((ch) => ch.name === name)!;
        expect(c.status).toBe("ok");
        expect(c.fixable).toBe(false);
      }
      for (const name of absent) {
        const c = checks.find((ch) => ch.name === name)!;
        expect(c.status).toBe("warn");
        expect(c.fixable).toBe(true);
      }
    });
  });

  // ─── CI workflow check — default path (no dx.config.toml) ────────────

  describe("ci.yml — default path (dx.config.toml absent)", () => {
    test("reports 'ok' when .github/workflows/ci.yml exists", async () => {
      touch(join(tmpDir, ".github/workflows/ci.yml"));

      const checks = await checkScaffold(tmpDir);
      const ci = checks.find((c) => c.name === "ci.yml")!;

      expect(ci.status).toBe("ok");
      expect(ci.message).toBe("present at .github/workflows/ci.yml");
      expect(ci.fixable).toBe(false);
    });

    test("reports 'warn' when .github/workflows/ci.yml is missing", async () => {
      const checks = await checkScaffold(tmpDir);
      const ci = checks.find((c) => c.name === "ci.yml")!;

      expect(ci.status).toBe("warn");
      expect(ci.message).toBe("missing — run kimi-fix");
      expect(ci.fixable).toBe(true);
    });
  });

  // ─── CI workflow check — custom path from dx.config.toml ─────────────

  describe("ci.yml — custom path from dx.config.toml", () => {
    test("reports 'ok' when custom workflow path exists", async () => {
      const workflowPath = ".github/workflows/deploy.yml";
      writeJson(join(tmpDir, "dx.config.toml"), ""); // TOML is not JSON, but Bun.TOML.parse will fail → fallback
      // Actually write proper TOML
      writeText(join(tmpDir, "dx.config.toml"), `[github]\nworkflow = "${workflowPath}"\n`);
      touch(join(tmpDir, workflowPath));

      const checks = await checkScaffold(tmpDir);
      const ci = checks.find((c) => c.name === "ci.yml")!;

      expect(ci.status).toBe("ok");
      expect(ci.message).toBe(`present at ${workflowPath}`);
      expect(ci.fixable).toBe(false);
    });

    test("reports 'warn' when custom workflow path is missing", async () => {
      const workflowPath = ".github/workflows/deploy.yml";
      writeText(join(tmpDir, "dx.config.toml"), `[github]\nworkflow = "${workflowPath}"\n`);

      const checks = await checkScaffold(tmpDir);
      const ci = checks.find((c) => c.name === "ci.yml")!;

      expect(ci.status).toBe("warn");
      expect(ci.message).toBe("missing — run kimi-fix");
      expect(ci.fixable).toBe(true);
    });

    test("falls back to default when dx.config.toml has no github.workflow key", async () => {
      writeText(join(tmpDir, "dx.config.toml"), `[other]\nkey = "value"\n`);
      touch(join(tmpDir, ".github/workflows/ci.yml"));

      const checks = await checkScaffold(tmpDir);
      const ci = checks.find((c) => c.name === "ci.yml")!;

      expect(ci.status).toBe("ok");
      expect(ci.message).toBe("present at .github/workflows/ci.yml");
    });

    test("falls back to default when dx.config.toml is unparseable", async () => {
      writeText(join(tmpDir, "dx.config.toml"), "this is not valid toml {{{");
      touch(join(tmpDir, ".github/workflows/ci.yml"));

      const checks = await checkScaffold(tmpDir);
      const ci = checks.find((c) => c.name === "ci.yml")!;

      expect(ci.status).toBe("ok");
      expect(ci.message).toBe("present at .github/workflows/ci.yml");
    });
  });

  // ─── CI workflow check — disabled ─────────────────────────────────────

  describe("ci.yml — disabled (workflows-disabled)", () => {
    const disabledPath = ".github/workflows-disabled/ci.yml";

    test("reports 'ok' with enforcement note when CI is disabled", async () => {
      writeText(join(tmpDir, "dx.config.toml"), `[github]\nworkflow = "${disabledPath}"\n`);
      // File does NOT exist at the disabled path

      const checks = await checkScaffold(tmpDir);
      const ci = checks.find((c) => c.name === "ci.yml")!;

      expect(ci.status).toBe("ok");
      expect(ci.message).toBe(
        "disabled (server CI unavailable) — enforcement via pre-push hooks + ci:local"
      );
      expect(ci.fixable).toBe(false);
    });

    test("reports disabled as 'ok' even if the file happens to exist there", async () => {
      writeText(join(tmpDir, "dx.config.toml"), `[github]\nworkflow = "${disabledPath}"\n`);
      touch(join(tmpDir, disabledPath));

      const checks = await checkScaffold(tmpDir);
      const ci = checks.find((c) => c.name === "ci.yml")!;

      // Present takes precedence over disabled
      expect(ci.status).toBe("ok");
      expect(ci.message).toBe(`present at ${disabledPath}`);
      expect(ci.fixable).toBe(false);
    });

    test("disabled via default path containing workflows-disabled", async () => {
      // No dx.config.toml; the DEFAULT_WORKFLOW_PATH does not contain
      // "workflows-disabled", so this test supplies a custom path via config
      // to exercise the pathImpliesDisabled branch in readDxCiConfig.
      writeText(
        join(tmpDir, "dx.config.toml"),
        `[github]\nworkflow = ".github/workflows-disabled/ci.yml"\n`
      );

      const checks = await checkScaffold(tmpDir);
      const ci = checks.find((c) => c.name === "ci.yml")!;

      expect(ci.status).toBe("ok");
      expect(ci.message).toContain("disabled");
      expect(ci.fixable).toBe(false);
    });
  });

  // ─── CI workflow check — github.ci.disabled boolean ──────────────────

  describe("ci.yml — github.ci.disabled (explicit boolean)", () => {
    test("reports 'ok' + disabled when github.ci.disabled = true and file is missing", async () => {
      writeText(
        join(tmpDir, "dx.config.toml"),
        `[github]\nworkflow = ".github/workflows/ci.yml"\n[github.ci]\ndisabled = true\n`
      );
      // File does NOT exist

      const checks = await checkScaffold(tmpDir);
      const ci = checks.find((c) => c.name === "ci.yml")!;

      expect(ci.status).toBe("ok");
      expect(ci.message).toContain("disabled");
      expect(ci.fixable).toBe(false);
    });

    test("present file takes precedence over github.ci.disabled = true", async () => {
      writeText(
        join(tmpDir, "dx.config.toml"),
        `[github]\nworkflow = ".github/workflows/ci.yml"\n[github.ci]\ndisabled = true\n`
      );
      touch(join(tmpDir, ".github/workflows/ci.yml"));

      const checks = await checkScaffold(tmpDir);
      const ci = checks.find((c) => c.name === "ci.yml")!;

      expect(ci.status).toBe("ok");
      expect(ci.message).toBe("present at .github/workflows/ci.yml");
      expect(ci.fixable).toBe(false);
    });

    test("path convention still wins when github.ci.disabled = false but path in workflows-disabled/", async () => {
      const disabledPath = ".github/workflows-disabled/ci.yml";
      writeText(
        join(tmpDir, "dx.config.toml"),
        `[github]\nworkflow = "${disabledPath}"\n[github.ci]\ndisabled = false\n`
      );

      const checks = await checkScaffold(tmpDir);
      const ci = checks.find((c) => c.name === "ci.yml")!;

      expect(ci.status).toBe("ok");
      expect(ci.message).toContain("disabled");
      expect(ci.fixable).toBe(false);
    });

    test("reports 'warn' when github.ci.disabled = false and file is genuinely missing", async () => {
      writeText(
        join(tmpDir, "dx.config.toml"),
        `[github]\nworkflow = ".github/workflows/ci.yml"\n[github.ci]\ndisabled = false\n`
      );
      // File does NOT exist

      const checks = await checkScaffold(tmpDir);
      const ci = checks.find((c) => c.name === "ci.yml")!;

      expect(ci.status).toBe("warn");
      expect(ci.message).toBe("missing — run kimi-fix");
      expect(ci.fixable).toBe(true);
    });
  });

  // ─── Package scripts check ────────────────────────────────────────────

  describe("package-scripts", () => {
    function validPkg(overrides?: Partial<Record<string, string>>) {
      const scripts: Record<string, string> = { ...REQUIRED_PACKAGE_SCRIPT_ENTRIES };
      if (overrides) Object.assign(scripts, overrides);
      return { name: "demo", scripts };
    }

    test("reports 'ok' when all required scripts are present", async () => {
      writeJson(join(tmpDir, "package.json"), validPkg());

      const checks = await checkScaffold(tmpDir);
      const ps = checks.find((c) => c.name === "package-scripts")!;

      expect(ps.status).toBe("ok");
      expect(ps.message).toBe("quality scripts defined");
      expect(ps.fixable).toBe(false);
    });

    test("reports 'warn' with missing script name when one script is absent", async () => {
      writeJson(join(tmpDir, "package.json"), validPkg({ test: undefined as unknown as string }));

      const checks = await checkScaffold(tmpDir);
      const ps = checks.find((c) => c.name === "package-scripts")!;

      expect(ps.status).toBe("warn");
      expect(ps.message).toContain("test");
      expect(ps.fixable).toBe(true);
    });

    test("reports 'warn' listing all missing scripts when several are absent", async () => {
      const pkg = validPkg();
      delete (pkg.scripts as Record<string, string>).test;
      delete (pkg.scripts as Record<string, string>).lint;
      delete (pkg.scripts as Record<string, string>).format;
      writeJson(join(tmpDir, "package.json"), pkg);

      const checks = await checkScaffold(tmpDir);
      const ps = checks.find((c) => c.name === "package-scripts")!;

      expect(ps.status).toBe("warn");
      expect(ps.message).toContain("test");
      expect(ps.message).toContain("lint");
      expect(ps.message).toContain("format");
      expect(ps.fixable).toBe(true);
    });

    test("handles package.json with no scripts field", async () => {
      writeJson(join(tmpDir, "package.json"), { name: "demo" });

      const checks = await checkScaffold(tmpDir);
      const ps = checks.find((c) => c.name === "package-scripts")!;

      expect(ps.status).toBe("warn");
      // All required scripts are missing
      expect(ps.message).toContain("missing:");
      expect(ps.fixable).toBe(true);
    });
  });

  // ─── Package.json error states ────────────────────────────────────────

  describe("package.json error states", () => {
    test("reports 'error' when package.json is missing entirely", async () => {
      const checks = await checkScaffold(tmpDir);
      const pkg = checks.find((c) => c.name === "package.json")!;

      expect(pkg.status).toBe("error");
      expect(pkg.message).toBe("missing");
      expect(pkg.fixable).toBe(false);

      // Early return: package-scripts check should NOT be in the results
      const ps = checks.find((c) => c.name === "package-scripts");
      expect(ps).toBeUndefined();
    });

    test("reports 'error' when package.json is invalid JSON", async () => {
      writeText(join(tmpDir, "package.json"), "not json {");

      const checks = await checkScaffold(tmpDir);
      const pkg = checks.find((c) => c.name === "package.json")!;

      expect(pkg.status).toBe("error");
      expect(pkg.message).toBe("invalid JSON");
      expect(pkg.fixable).toBe(false);
    });
  });

  // ─── Full integration — all checks together ──────────────────────────

  describe("full scaffold", () => {
    test("all checks present in a complete project", async () => {
      // Create every file the doctor looks for
      for (const rel of Object.values(FILE_PATHS)) touch(join(tmpDir, rel));
      touch(join(tmpDir, ".github/workflows/ci.yml"));
      writeJson(join(tmpDir, "package.json"), {
        name: "demo",
        scripts: REQUIRED_PACKAGE_SCRIPT_ENTRIES,
      });

      const checks = await checkScaffold(tmpDir);

      // Every check should be "ok"
      const notOk = checks.filter((c) => c.status !== "ok");
      expect(notOk).toEqual([]);

      // Verify all expected check names are present
      const names = checks.map((c) => c.name).sort();
      expect(names).toContain("ci.yml");
      expect(names).toContain("package-scripts");
      for (const f of EXPECTED_FILE_NAMES) expect(names).toContain(f);

      // No fixable items in a complete project
      const fixable = checks.filter((c) => c.fixable);
      expect(fixable).toEqual([]);
    });

    test("empty project — all warns except package.json", async () => {
      // package.json missing → error
      const checks = await checkScaffold(tmpDir);

      const pkg = checks.find((c) => c.name === "package.json")!;
      expect(pkg.status).toBe("error");

      // All file checks should be warn
      for (const name of EXPECTED_FILE_NAMES) {
        const c = checks.find((ch) => ch.name === name)!;
        expect(c.status).toBe("warn");
      }

      // ci.yml should be warn (missing, not disabled)
      const ci = checks.find((c) => c.name === "ci.yml")!;
      expect(ci.status).toBe("warn");
      expect(ci.fixable).toBe(true);
    });
  });
});
