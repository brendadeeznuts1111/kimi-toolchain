import { describe, expect, test } from "bun:test";
import { checkGovernance } from "../src/lib/governance-check.ts";
import {
  generateReadme,
  generateLicense,
  scaffoldAdr,
  ADR_TEMPLATE,
} from "../src/lib/scaffold-templates.ts";
import { parseCommit, determineBump, bumpVersion } from "../src/lib/conventional-commits.ts";
import { commitsToSection, formatSection, updateChangelog } from "../src/lib/changelog.ts";
import { ensureQualityTooling } from "../src/lib/scaffold-quality.ts";
import { join } from "path";
import { artifactPath } from "../src/lib/artifacts.ts";
import { makeDir, pathExists } from "./helpers.ts";

const REPO_ROOT = import.meta.dir + "/..";

function tmpDir(name: string): string {
  const ts = Date.now();
  const dir = artifactPath(REPO_ROOT, "tmp", `${name}-${ts}`);
  makeDir(dir, { recursive: true });
  return dir;
}

async function writeFile(path: string, content: string) {
  await Bun.write(path, content);
}

async function cleanup(dir: string) {
  await Bun.spawn(["rm", "-rf", dir]).exited;
}

/* ─────────────────────── governance-check ─────────────────────── */

describe("checkGovernance", () => {
  test("returns all false for empty directory", async () => {
    const dir = tmpDir("gov-empty");
    const result = await checkGovernance(dir);
    expect(result).toEqual({
      hasLicense: false,
      hasContributing: false,
      hasCodeowners: false,
      hasReadme: false,
      hasContext: false,
      hasChangelog: false,
      licenseType: null,
      codeowners: [],
    });
    await cleanup(dir);
  });

  test("detects all governance files", async () => {
    const dir = tmpDir("gov-full");
    await writeFile(join(dir, "LICENSE"), "MIT License\n");
    await writeFile(join(dir, "README.md"), "# Readme\n");
    await writeFile(join(dir, "CONTRIBUTING.md"), "# Contributing\n");
    await writeFile(join(dir, "CHANGELOG.md"), "# Changelog\n");
    await writeFile(join(dir, "CONTEXT.md"), "# Context\n");
    await writeFile(join(dir, "CODEOWNERS"), "* @alice\n");
    const result = await checkGovernance(dir);
    expect(result.hasLicense).toBe(true);
    expect(result.licenseType).toBe("MIT");
    expect(result.hasReadme).toBe(true);
    expect(result.hasContributing).toBe(true);
    expect(result.hasChangelog).toBe(true);
    expect(result.hasContext).toBe(true);
    expect(result.hasCodeowners).toBe(true);
    expect(result.codeowners).toEqual(["@alice"]);
    await cleanup(dir);
  });

  test("license type detection: MIT", async () => {
    const dir = tmpDir("gov-mit");
    await writeFile(join(dir, "LICENSE"), "MIT License\n");
    const result = await checkGovernance(dir);
    expect(result.licenseType).toBe("MIT");
    await cleanup(dir);
  });

  test("license type detection: Apache-2.0", async () => {
    const dir = tmpDir("gov-apache");
    await writeFile(join(dir, "LICENSE"), "Apache License 2.0\n");
    const result = await checkGovernance(dir);
    expect(result.licenseType).toBe("Apache-2.0");
    await cleanup(dir);
  });

  test("license type detection: BSD", async () => {
    const dir = tmpDir("gov-bsd");
    await writeFile(join(dir, "LICENSE"), "BSD License\n");
    const result = await checkGovernance(dir);
    expect(result.licenseType).toBe("BSD");
    await cleanup(dir);
  });

  test("license type detection: GPL", async () => {
    const dir = tmpDir("gov-gpl");
    await writeFile(join(dir, "LICENSE"), "GNU GPL License\n");
    const result = await checkGovernance(dir);
    expect(result.licenseType).toBe("GPL");
    await cleanup(dir);
  });

  test("license type detection: Unknown", async () => {
    const dir = tmpDir("gov-unknown");
    await writeFile(join(dir, "LICENSE"), "Some Custom License\n");
    const result = await checkGovernance(dir);
    expect(result.licenseType).toBe("Unknown");
    await cleanup(dir);
  });

  test("CODEOWNERS parsing from .github/CODEOWNERS", async () => {
    const dir = tmpDir("gov-gh-codeowners");
    makeDir(join(dir, ".github"), { recursive: true });
    await writeFile(
      join(dir, ".github", "CODEOWNERS"),
      "# Comment\n* @alice @bob\n/src @carol-doe\n"
    );
    const result = await checkGovernance(dir);
    expect(result.hasCodeowners).toBe(true);
    expect(result.codeowners).toEqual(["@alice", "@bob", "@carol-doe"]);
    await cleanup(dir);
  });

  test("CODEOWNERS parsing from docs/CODEOWNERS", async () => {
    const dir = tmpDir("gov-docs-codeowners");
    makeDir(join(dir, "docs"), { recursive: true });
    await writeFile(join(dir, "docs", "CODEOWNERS"), "* @team-lead\n");
    const result = await checkGovernance(dir);
    expect(result.hasCodeowners).toBe(true);
    expect(result.codeowners).toEqual(["@team-lead"]);
    await cleanup(dir);
  });
});

/* ─────────────────────── scaffold-templates ─────────────────────── */

describe("generateReadme", () => {
  test("returns correct content with project name", async () => {
    const dir = tmpDir("readme");
    const getProjectName = async () => "my-project";
    const path = await generateReadme(dir, getProjectName);
    expect(path).toBe(join(dir, "README.md"));
    const content = await Bun.file(path).text();
    expect(content).toContain("# my-project");
    expect(content).toContain("## Quickstart");
    expect(content).toContain("bun install");
    expect(content).toContain("bun run check:fast");
    await cleanup(dir);
  });
});

describe("generateLicense", () => {
  test("returns correct MIT content", async () => {
    const dir = tmpDir("license-mit");
    const path = await generateLicense(dir, "MIT");
    expect(path).toBe(join(dir, "LICENSE"));
    const content = await Bun.file(path).text();
    expect(content).toContain("MIT License");
    expect(content).toContain("Copyright (c)");
    expect(content).toContain("Permission is hereby granted,");
    await cleanup(dir);
  });

  test("returns correct generic content for non-MIT", async () => {
    const dir = tmpDir("license-apache");
    const path = await generateLicense(dir, "Apache-2.0");
    const content = await Bun.file(path).text();
    expect(content).toContain("Apache-2.0 License");
    expect(content).toContain("Copyright (c)");
    await cleanup(dir);
  });
});

describe("scaffoldAdr", () => {
  test("creates file with correct naming pattern", async () => {
    const dir = tmpDir("adr");
    const ensureDir = (d: string) => makeDir(d, { recursive: true });
    const path = await scaffoldAdr(dir, "Use Bun Runtime", ensureDir);
    expect(path).toMatch(/0001-use-bun-runtime\.md$/);
    expect(pathExists(path)).toBe(true);
    const content = await Bun.file(path).text();
    expect(content).toContain("# Use Bun Runtime");
    expect(content).toContain("status: proposed");
    await cleanup(dir);
  });

  test("increments number for existing ADRs", async () => {
    const dir = tmpDir("adr-multi");
    const ensureDir = (d: string) => makeDir(d, { recursive: true });
    await scaffoldAdr(dir, "First Decision", ensureDir);
    const path = await scaffoldAdr(dir, "Second Decision", ensureDir);
    expect(path).toMatch(/0002-second-decision\.md$/);
    await cleanup(dir);
  });
});

describe("ADR_TEMPLATE", () => {
  test("contains required markers", () => {
    expect(ADR_TEMPLATE).toContain("{{DATE}}");
    expect(ADR_TEMPLATE).toContain("{{DECIDERS}}");
    expect(ADR_TEMPLATE).toContain("{{TITLE}}");
    expect(ADR_TEMPLATE).toContain("## Context");
    expect(ADR_TEMPLATE).toContain("## Decision");
    expect(ADR_TEMPLATE).toContain("## Consequences");
    expect(ADR_TEMPLATE).toContain("### Positive");
    expect(ADR_TEMPLATE).toContain("### Negative");
    expect(ADR_TEMPLATE).toContain("### Neutral");
    expect(ADR_TEMPLATE).toContain("## Alternatives Considered");
    expect(ADR_TEMPLATE).toContain("## References");
  });
});

/* ─────────────────────── conventional-commits ─────────────────────── */

describe("parseCommit", () => {
  test("parses feat(scope): msg", () => {
    const c = parseCommit("abc1234", "feat(api): add users endpoint", "");
    expect(c).toEqual({
      hash: "abc1234",
      subject: "feat(api): add users endpoint",
      body: "",
      type: "feat",
      scope: "api",
      breaking: false,
    });
  });

  test("parses fix: msg", () => {
    const c = parseCommit("def5678", "fix: resolve null pointer", "");
    expect(c).toEqual({
      hash: "def5678",
      subject: "fix: resolve null pointer",
      body: "",
      type: "fix",
      scope: undefined,
      breaking: false,
    });
  });

  test("parses feat!: breaking", () => {
    const c = parseCommit("ghi9012", "feat!: drop legacy support", "");
    expect(c).toEqual({
      hash: "ghi9012",
      subject: "feat!: drop legacy support",
      body: "",
      type: "feat",
      scope: undefined,
      breaking: false,
    });
  });

  test("parses breaking via body", () => {
    const c = parseCommit("jkl3456", "feat: change api", "BREAKING CHANGE: new schema");
    expect(c).toEqual({
      hash: "jkl3456",
      subject: "feat: change api",
      body: "BREAKING CHANGE: new schema",
      type: "feat",
      scope: undefined,
      breaking: true,
    });
  });

  test("returns null for non-conventional subject", () => {
    const c = parseCommit("mno7890", "random commit message", "");
    expect(c).toBeNull();
  });

  test("lowercases type", () => {
    const c = parseCommit("pqr1234", "FEAT(ui): dark mode", "");
    expect(c?.type).toBe("feat");
  });
});

describe("determineBump", () => {
  test("returns major for breaking commit", () => {
    const commits = [{ type: "feat", breaking: true } as any];
    expect(determineBump(commits)).toBe("major");
  });

  test("returns minor for feat without breaking", () => {
    const commits = [{ type: "feat", breaking: false } as any];
    expect(determineBump(commits)).toBe("minor");
  });

  test("returns patch for fix without breaking", () => {
    const commits = [{ type: "fix", breaking: false } as any];
    expect(determineBump(commits)).toBe("patch");
  });

  test("returns none for no relevant commits", () => {
    const commits = [{ type: "chore", breaking: false } as any];
    expect(determineBump(commits)).toBe("none");
  });

  test("breaking takes precedence over feat", () => {
    const commits = [
      { type: "feat", breaking: false } as any,
      { type: "fix", breaking: true } as any,
    ];
    expect(determineBump(commits)).toBe("major");
  });

  test("feat takes precedence over fix", () => {
    const commits = [
      { type: "fix", breaking: false } as any,
      { type: "feat", breaking: false } as any,
    ];
    expect(determineBump(commits)).toBe("minor");
  });
});

describe("bumpVersion", () => {
  test("bumps major", () => {
    expect(bumpVersion("1.2.3", "major")).toBe("2.0.0");
  });

  test("bumps minor", () => {
    expect(bumpVersion("1.2.3", "minor")).toBe("1.3.0");
  });

  test("bumps patch", () => {
    expect(bumpVersion("1.2.3", "patch")).toBe("1.2.4");
  });

  test("handles v prefix", () => {
    expect(bumpVersion("v1.2.3", "major")).toBe("2.0.0");
  });
});

/* ─────────────────────── changelog ─────────────────────── */

describe("commitsToSection", () => {
  test("maps commit types to correct categories", () => {
    const commits = [
      {
        hash: "aaa1111",
        subject: "feat(api): new endpoint",
        body: "",
        type: "feat",
        scope: "api",
        breaking: false,
      },
      {
        hash: "bbb2222",
        subject: "fix: bug fix",
        body: "",
        type: "fix",
        scope: undefined,
        breaking: false,
      },
      {
        hash: "ccc3333",
        subject: "docs: update readme",
        body: "",
        type: "docs",
        scope: undefined,
        breaking: false,
      },
      {
        hash: "ddd4444",
        subject: "refactor: cleanup",
        body: "",
        type: "refactor",
        scope: undefined,
        breaking: false,
      },
      {
        hash: "eee5555",
        subject: "perf: optimize",
        body: "",
        type: "perf",
        scope: undefined,
        breaking: false,
      },
      {
        hash: "fff6666",
        subject: "test: add tests",
        body: "",
        type: "test",
        scope: undefined,
        breaking: false,
      },
      {
        hash: "ggg7777",
        subject: "chore: bump deps",
        body: "",
        type: "chore",
        scope: undefined,
        breaking: false,
      },
      {
        hash: "hhh8888",
        subject: "deps: update lib",
        body: "",
        type: "deps",
        scope: undefined,
        breaking: false,
      },
      {
        hash: "iii9999",
        subject: "feat!: breaking",
        body: "",
        type: "feat",
        scope: undefined,
        breaking: true,
      },
    ];
    const section = commitsToSection(commits, "1.0.0");
    expect(section.version).toBe("1.0.0");
    expect(section.added.length).toBe(1);
    expect(section.added[0]).toContain("new endpoint");
    expect(section.fixed.length).toBe(1);
    expect(section.fixed[0]).toContain("bug fix");
    expect(section.changed.length).toBe(5); // docs, refactor, perf, test, chore
    expect(section.security.length).toBe(1);
    expect(section.security[0]).toContain("update lib");
    expect(section.breaking.length).toBe(1);
    expect(section.breaking[0]).toContain("breaking");
  });

  test("includes hash link in entries", () => {
    const commits = [
      {
        hash: "abc1234",
        subject: "feat: x",
        body: "",
        type: "feat",
        scope: undefined,
        breaking: false,
      },
    ];
    const section = commitsToSection(commits, "1.0.0");
    expect(section.added[0]).toContain("([abc1234])");
  });
});

describe("formatSection", () => {
  test("produces valid markdown", () => {
    const section = {
      version: "1.0.0",
      date: "2024-01-01",
      added: ["feature A ([abc1234])"],
      changed: [],
      fixed: ["bug B ([def5678])"],
      deprecated: [],
      removed: [],
      security: [],
      breaking: [],
    };
    const md = formatSection(section);
    expect(md).toContain("## [1.0.0] - 2024-01-01");
    expect(md).toContain("### Added");
    expect(md).toContain("- feature A ([abc1234])");
    expect(md).toContain("### Fixed");
    expect(md).toContain("- bug B ([def5678])");
  });

  test("includes breaking changes section when present", () => {
    const section = {
      version: "2.0.0",
      date: "2024-02-01",
      added: [],
      changed: [],
      fixed: [],
      deprecated: [],
      removed: [],
      security: [],
      breaking: ["drop support ([abc1234])"],
    };
    const md = formatSection(section);
    expect(md).toContain("### ⚠ BREAKING CHANGES");
    expect(md).toContain("- drop support ([abc1234])");
  });

  test("omits empty categories", () => {
    const section = {
      version: "1.0.0",
      date: "2024-01-01",
      added: [],
      changed: [],
      fixed: [],
      deprecated: [],
      removed: [],
      security: [],
      breaking: [],
    };
    const md = formatSection(section);
    expect(md).not.toContain("### Added");
    expect(md).not.toContain("### Fixed");
  });
});

describe("updateChangelog", () => {
  test("inserts section correctly with Unreleased", async () => {
    const dir = tmpDir("changelog");
    const initial = `# Changelog\n\n## [Unreleased]\n\n### Added\n- Initial\n\n## [1.0.0] - 2024-01-01\n`;
    await writeFile(join(dir, "CHANGELOG.md"), initial);
    const section = "## [1.1.0] - 2024-02-01\n\n### Added\n- New feature\n";
    await updateChangelog(dir, section, "1.1.0");
    const content = await Bun.file(join(dir, "CHANGELOG.md")).text();
    expect(content.indexOf("## [1.1.0]")).toBeGreaterThan(content.indexOf("## [Unreleased]"));
    expect(content.indexOf("## [1.1.0]")).toBeLessThan(content.indexOf("## [1.0.0]"));
    await cleanup(dir);
  });

  test("creates new changelog if none exists", async () => {
    const dir = tmpDir("changelog-new");
    const section = "## [1.0.0] - 2024-01-01\n\n### Added\n- Initial\n";
    await updateChangelog(dir, section, "1.0.0");
    const content = await Bun.file(join(dir, "CHANGELOG.md")).text();
    expect(content).toContain("## [1.0.0]");
    expect(content).toContain("# Changelog");
    await cleanup(dir);
  });
});

/* ─────────────────────── scaffold-quality ─────────────────────── */

const STUB_DEV_DEPS = {
  oxfmt: "0.0.0",
  oxlint: "0.0.0",
  typescript: "0.0.0",
  "@types/bun": "0.0.0",
};

describe("ensureQualityTooling", () => {
  test("adds missing scripts to package.json", async () => {
    const dir = tmpDir("quality-add");
    const pkg = {
      name: "test",
      scripts: { test: "bun test" },
      devDependencies: { ...STUB_DEV_DEPS },
    };
    await writeFile(join(dir, "package.json"), JSON.stringify(pkg, null, 2));
    const logs: string[] = [];
    const log = (_step: string, msg: string) => logs.push(msg);
    await ensureQualityTooling(dir, false, log);
    const updated = await Bun.file(join(dir, "package.json")).json();
    expect(updated.scripts.typecheck).toBe("tsc --noEmit");
    expect(updated.scripts.format).toBe("oxfmt --write .");
    expect(updated.scripts.lint).toBe(
      "oxlint src test scripts && bun run scripts/lint-banned-terms.ts"
    );
    expect(updated.scripts.check).toBe("bun run scripts/check.ts");
    expect(logs.some((l) => l.includes("adding format/lint/test scripts"))).toBe(true);
    await cleanup(dir);
  });

  test("is idempotent — does not duplicate existing scripts", async () => {
    const dir = tmpDir("quality-idempotent");
    const pkg = {
      name: "test",
      devDependencies: { ...STUB_DEV_DEPS },
      scripts: {
        test: "bun test",
        "test:fast": "bun test --fast",
        "test:coverage": "bun test --coverage",
        "test:coverage:ci": "bun test --ci --coverage",
        check: "bun run check",
        "check:fast": "bun run check --fast",
        "check:dry-run": "bun run check --dry-run",
        "docs:sync": "bun run docs:sync",
        typecheck: "tsc --noEmit",
        format: "oxfmt --write .",
        "format:check": "oxfmt --check .",
        "format:check:ci": "oxfmt --check --threads=4 .",
        lint: "oxlint src",
        "lint:terms": "bun run lint:terms",
        fix: "kimi-fix .",
      },
    };
    await writeFile(join(dir, "package.json"), JSON.stringify(pkg, null, 2));
    const logs: string[] = [];
    const log = (_step: string, msg: string) => logs.push(msg);
    await ensureQualityTooling(dir, false, log);
    const updated = await Bun.file(join(dir, "package.json")).json();
    expect(updated.scripts.typecheck).toBe("tsc --noEmit");
    expect(updated.scripts.format).toBe("oxfmt --write .");
    expect(logs.some((l) => l.includes("adding format/lint/test scripts"))).toBe(false);
    await cleanup(dir);
  });

  test("dryRun does not write file", async () => {
    const dir = tmpDir("quality-dryrun");
    const pkg = { name: "test", scripts: {} };
    await writeFile(join(dir, "package.json"), JSON.stringify(pkg, null, 2));
    const logs: string[] = [];
    const log = (_step: string, msg: string) => logs.push(msg);
    await ensureQualityTooling(dir, true, log);
    const updated = await Bun.file(join(dir, "package.json")).json();
    expect(updated.scripts.typecheck).toBeUndefined();
    expect(logs.some((l) => l.includes("adding format/lint/test scripts"))).toBe(true);
    await cleanup(dir);
  });

  test("returns early if no package.json", async () => {
    const dir = tmpDir("quality-nopkg");
    const logs: string[] = [];
    const log = (_step: string, msg: string) => logs.push(msg);
    await ensureQualityTooling(dir, false, log);
    expect(logs.length).toBe(0);
    await cleanup(dir);
  });
});
