import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  checkDxGithubAlignment,
  REQUIRED_AGENT_BOOTSTRAP,
} from "../src/lib/dx-github-alignment.ts";

let projectDir: string;

function writeProject(files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(projectDir, path);
    mkdirSync(fullPath.split("/").slice(0, -1).join("/"), { recursive: true });
    writeFileSync(fullPath, content);
  }
}

function packageJson(extraScripts: Record<string, string> = {}): string {
  return JSON.stringify(
    {
      name: "demo",
      packageManager: "bun@1.3.14",
      scripts: {
        "format:check": "oxfmt --check .",
        "format:check:ci": "oxfmt --check --threads=4 .",
        lint: "oxlint src test scripts",
        typecheck: "tsc --noEmit",
        check: "bun run scripts/check.ts",
        "check:fast": "bun run scripts/check.ts --fast",
        "test:fast": "bun test --timeout 500",
        "test:coverage:ci": "bun test --ci --coverage",
        "test:smoke": "bun test test/smoke",
        sync: "bun run scripts/sync-to-desktop.ts",
        "sync:verify": "bun run scripts/sync-verify.ts",
        ...extraScripts,
      },
    },
    null,
    2
  );
}

const DX_CONFIG = `
schemaVersion = 1
name = "demo"
scope = "project"

[runtime]
packageManager = "bun"
bunVersion = "1.3.14"

[github]
workflow = ".github/workflows/ci.yml"
setupAction = ".github/actions/setup/action.yml"

[github.ci]
bunVersion = "1.3.14"

[github.ci.quality]
format = "bun run format:check:ci"
lint = "bun run lint"
typecheck = "bun run typecheck"
tests = "bun run test:coverage:ci"
smoke = "bun run test:smoke"

[github.ci.governance]
rScore = "bun run governance score --min 60"

[quality]
formatCheck = "bun run format:check"
lintCheck = "bun run lint"
typecheck = "bun run typecheck"
check = "bun run check"
checkFast = "bun run check:fast"
testFast = "bun run test:fast"
testCoverageCi = "bun run test:coverage:ci"
formatCheckCi = "bun run format:check:ci"

[sync]
verify = "bun run sync:verify"

[agents]
firstRead = ["/Users/nolarose/.config/dx/AGENTS.md", "AGENTS.md", "CODE_REFERENCES.md"]
bootstrap = ["dx setup", "dx context", "dx config --project .", "dx mcp-status", "dx cli", "dx package"]
iterate = "bun run check:fast"
fullValidation = "bun run check"
prePush = ["kimi-githooks doctor", "bun run check:fast", "kimi-guardian check", "kimi-doctor --effect-gates", "kimi-governance score"]
handoff = ["bun run sync && bun run sync:verify", "kimi-doctor --agent-ready"]
`;

const CI = `
name: CI
on:
  pull_request:
    branches: [main]
jobs:
  quality:
    steps:
      - run: bun run format:check:ci
      - run: bun run lint
      - run: bun run typecheck
      - run: bun run test:coverage:ci
      - run: bun run test:smoke
  governance:
    steps:
      - run: bun run governance score --min 60
`;

const SETUP_ACTION = `
name: Setup
runs:
  using: composite
  steps:
    - uses: oven-sh/setup-bun@v2
      with:
        bun-version: "1.3.14"
`;

const SETUP_ACTION_WITH_PREFLIGHT = `
name: Setup
runs:
  using: composite
  steps:
    - name: Preflight
      shell: bash
      run: echo ready
    - uses: oven-sh/setup-bun@v2
      with:
        bun-version: "1.3.14"
`;

beforeEach(() => {
  projectDir = join(tmpdir(), `kimi-dx-gh-${Bun.randomUUIDv7()}`);
  mkdirSync(projectDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(projectDir)) rmSync(projectDir, { recursive: true, force: true });
});

describe("dx-github-alignment", () => {
  test("passes when dx config, package scripts, and GitHub CI match", async () => {
    writeProject({
      "dx.config.toml": DX_CONFIG,
      "package.json": packageJson({ governance: "bun run src/bin/kimi-governance.ts" }),
      ".github/workflows/ci.yml": CI,
      ".github/actions/setup/action.yml": SETUP_ACTION,
    });

    const report = await checkDxGithubAlignment(projectDir);

    expect(report.applicable).toBe(true);
    expect(report.aligned).toBe(true);
    expect(report.checks.every((check) => check.status === "ok")).toBe(true);
  });

  test("warns when GitHub CI no longer runs the configured command", async () => {
    writeProject({
      "dx.config.toml": DX_CONFIG,
      "package.json": packageJson({ governance: "bun run src/bin/kimi-governance.ts" }),
      ".github/workflows/ci.yml": CI.replace("bun run lint", "bun run lint:changed"),
      ".github/actions/setup/action.yml": SETUP_ACTION,
    });

    const report = await checkDxGithubAlignment(projectDir);
    const lintCheck = report.checks.find((check) => check.name === "github.ci.quality.lint");

    expect(report.aligned).toBe(false);
    expect(lintCheck?.status).toBe("warn");
  });

  test("warns when CI-only package scripts disappear", async () => {
    writeProject({
      "dx.config.toml": DX_CONFIG,
      "package.json": packageJson({ "test:smoke": "", governance: "" }),
      ".github/workflows/ci.yml": CI,
      ".github/actions/setup/action.yml": SETUP_ACTION,
    });

    const report = await checkDxGithubAlignment(projectDir);

    expect(report.aligned).toBe(false);
    expect(
      report.checks.find((check) => check.name === "github.ci.quality.smoke.script")?.status
    ).toBe("warn");
    expect(
      report.checks.find((check) => check.name === "github.ci.governance.rScore.script")?.status
    ).toBe("warn");
  });

  test("warns when agent flow defaults drift", async () => {
    writeProject({
      "dx.config.toml": DX_CONFIG.replace(
        'bootstrap = ["dx setup", "dx context", "dx config --project .", "dx mcp-status", "dx cli", "dx package"]',
        'bootstrap = ["dx context"]'
      ).replace(
        'handoff = ["bun run sync && bun run sync:verify", "kimi-doctor --agent-ready"]',
        'handoff = ["bun run sync"]'
      ),
      "package.json": packageJson({ governance: "bun run src/bin/kimi-governance.ts" }),
      ".github/workflows/ci.yml": CI,
      ".github/actions/setup/action.yml": SETUP_ACTION,
    });

    const report = await checkDxGithubAlignment(projectDir);

    expect(report.aligned).toBe(false);
    expect(report.checks.find((check) => check.name === "agents.bootstrap")?.status).toBe("warn");
    expect(report.checks.find((check) => check.name === "agents.handoff")?.status).toBe("warn");
  });

  test("warns when bootstrap omits dx setup and dx cli", async () => {
    writeProject({
      "dx.config.toml": DX_CONFIG.replace(
        'bootstrap = ["dx setup", "dx context", "dx config --project .", "dx mcp-status", "dx cli", "dx package"]',
        'bootstrap = ["dx context", "dx config --project .", "dx mcp-status", "dx package"]'
      ),
      "package.json": packageJson({ governance: "bun run src/bin/kimi-governance.ts" }),
      ".github/workflows/ci.yml": CI,
      ".github/actions/setup/action.yml": SETUP_ACTION,
    });

    const report = await checkDxGithubAlignment(projectDir);
    const bootstrap = report.checks.find((check) => check.name === "agents.bootstrap");

    expect(report.aligned).toBe(false);
    expect(bootstrap?.status).toBe("warn");
    expect(bootstrap?.message).toContain("dx setup");
    expect(bootstrap?.message).toContain("dx cli");
  });

  test("warns on parseable dx config sections with wrong value shapes", async () => {
    writeProject({
      "dx.config.toml": DX_CONFIG.replace(
        'packageManager = "bun"',
        'packageManager = ["bun"]'
      ).replace('bunVersion = "1.3.14"', "bunVersion = 1314"),
      "package.json": packageJson({ governance: "bun run src/bin/kimi-governance.ts" }),
      ".github/workflows/ci.yml": CI,
      ".github/actions/setup/action.yml": SETUP_ACTION,
    });

    const report = await checkDxGithubAlignment(projectDir);

    expect(report.aligned).toBe(false);
    expect(report.checks.find((check) => check.name === "runtime.packageManager")?.status).toBe(
      "warn"
    );
    expect(report.checks.find((check) => check.name === "runtime.bunVersion")?.status).toBe("warn");
  });

  test("warns when command defaults are present but not strings", async () => {
    writeProject({
      "dx.config.toml": DX_CONFIG.replace('lint = "bun run lint"', "lint = false").replace(
        'lintCheck = "bun run lint"',
        'lintCheck = ["bun run lint"]'
      ),
      "package.json": packageJson({ governance: "bun run src/bin/kimi-governance.ts" }),
      ".github/workflows/ci.yml": CI,
      ".github/actions/setup/action.yml": SETUP_ACTION,
    });

    const report = await checkDxGithubAlignment(projectDir);

    expect(report.aligned).toBe(false);
    expect(report.checks.find((check) => check.name === "quality.lintCheck")?.status).toBe("warn");
    expect(report.checks.find((check) => check.name === "github.ci.quality.lint")?.status).toBe(
      "warn"
    );
  });

  test("warns when setup action steps have a malformed shape", async () => {
    writeProject({
      "dx.config.toml": DX_CONFIG,
      "package.json": packageJson({ governance: "bun run src/bin/kimi-governance.ts" }),
      ".github/workflows/ci.yml": CI,
      ".github/actions/setup/action.yml":
        "name: Setup\nruns:\n  using: composite\n  steps: not-a-list\n",
    });

    const report = await checkDxGithubAlignment(projectDir);

    expect(report.aligned).toBe(false);
    expect(report.checks.find((check) => check.name === "github.setupAction")?.status).toBe("warn");
  });

  test("finds setup Bun version after earlier composite steps", async () => {
    writeProject({
      "dx.config.toml": DX_CONFIG,
      "package.json": packageJson({ governance: "bun run src/bin/kimi-governance.ts" }),
      ".github/workflows/ci.yml": CI,
      ".github/actions/setup/action.yml": SETUP_ACTION_WITH_PREFLIGHT,
    });

    const report = await checkDxGithubAlignment(projectDir);

    expect(report.aligned).toBe(true);
    expect(report.checks.find((check) => check.name === "github.ci.bunVersion")?.status).toBe("ok");
  });

  test("skips projects without dx config", async () => {
    writeProject({ "package.json": packageJson() });

    const report = await checkDxGithubAlignment(projectDir);

    expect(report.applicable).toBe(false);
    expect(report.aligned).toBe(true);
  });

  test("project and scaffold dx templates keep the required bootstrap defaults", () => {
    const projectConfig = Bun.TOML.parse(
      readFileSync(join(import.meta.dir, "..", "dx.config.toml"), "utf8")
    ) as { agents?: { bootstrap?: string[] } };
    const scaffoldConfig = Bun.TOML.parse(
      readFileSync(join(import.meta.dir, "..", "templates", "scaffold", "dx.config.toml"), "utf8")
    ) as { agents?: { bootstrap?: string[] } };

    expect(projectConfig.agents?.bootstrap).toEqual([...REQUIRED_AGENT_BOOTSTRAP]);
    expect(scaffoldConfig.agents?.bootstrap).toEqual([...REQUIRED_AGENT_BOOTSTRAP]);
  });
});
