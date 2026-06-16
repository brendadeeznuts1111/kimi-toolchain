/**
 * Canonical scaffold templates — single source of truth for kimi-fix.
 * Template bodies live in templates/scaffold/ (diffable, editable as plain files).
 * This module reads them at import time and re-exports as constants.
 * Keep in sync with TEMPLATES.md (validated by unit test).
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";

function resolveTemplateDir(): string {
  const candidates = [
    join(import.meta.dir, "..", "..", "templates", "scaffold"),
    join(import.meta.dir, "..", "templates", "scaffold"),
  ];
  return candidates.find((dir) => existsSync(dir)) ?? candidates[0];
}

const TEMPLATE_DIR = resolveTemplateDir();

function load(name: string): string {
  return readFileSync(join(TEMPLATE_DIR, name), "utf8");
}

// ── Config templates ─────────────────────────────────────────────────

export const OXFMTRC = load("oxfmtrc.json");
export const OXLINTRC = load("oxlintrc.json");
export const CI_WORKFLOW = load("ci.yml");
export const TSCONFIG = load("tsconfig.json");
export const BUN_GLOBALS = load("bun-globals.d.ts");
export const DX_CONFIG_APP = load("dx.config.app.toml");
export const DX_CONFIG_TOOLCHAIN = load("dx.config.toolchain.toml");
/** Default scaffold profile (app). */
export const DX_CONFIG = DX_CONFIG_APP;
export const GITIGNORE = load("gitignore");
export const ENV_EXAMPLE = load("env.example");
export const BUNFIG = load("bunfig.toml");
export const KIMI_SKILLS_README = load("skills-readme.md");
export const ADR_TEMPLATE = load("adr-template.md");
export const CODE_REFERENCES_TEMPLATE = load("code-references.md");
export const MIT_LICENSE_TEMPLATE = load("LICENSE-MIT");

// ── Generator functions ──────────────────────────────────────────────

/** Required package.json scripts added by kimi-fix and audited by scaffold doctor. */
export const REQUIRED_PACKAGE_SCRIPT_ENTRIES = {
  test: "bun run scripts/run-tests.ts",
  "test:fast": "bun run scripts/run-tests.ts --fast",
  "test:coverage": "bun run scripts/run-tests.ts --coverage",
  "test:coverage:ci": "bun run scripts/run-tests.ts --ci --coverage",
  check: "bun run scripts/check.ts",
  "check:fast": "bun run scripts/check.ts --fast",
  "check:dry-run": "bun run scripts/check.ts --dry-run",
  "docs:sync": "bun run scripts/readme-sync.ts --fix",
  typecheck: "tsc --noEmit",
  format: "oxfmt --write -c .oxfmtrc.json src scripts test",
  "format:check": "oxfmt --check -c .oxfmtrc.json src scripts test",
  "format:check:ci": "oxfmt --check --threads=4 -c .oxfmtrc.json src scripts test",
  lint: "oxlint src test scripts && bun run scripts/lint-banned-terms.ts",
  "lint:terms": "bun run scripts/lint-banned-terms.ts",
  fix: "kimi-fix .",
} as const;

export const TOOLCHAIN_PACKAGE_SCRIPT_ENTRIES = {
  "finish-work": "bun run scripts/finish-work.ts",
} as const;

export const REQUIRED_PACKAGE_SCRIPTS = Object.keys(REQUIRED_PACKAGE_SCRIPT_ENTRIES) as Array<
  keyof typeof REQUIRED_PACKAGE_SCRIPT_ENTRIES
>;

/** Generate README.md with project name and basic structure. */
export async function generateReadme(
  projectDir: string,
  getProjectName: (dir: string) => Promise<string>
): Promise<string> {
  const filepath = join(projectDir, "README.md");
  const content = `# ${await getProjectName(projectDir)}\n\n## Getting Started\n\n\`\`\`bash\nbun install\nbun run dev\n\`\`\`\n\n## Scripts\n\nSee \`package.json\` for available scripts.\n`;
  await Bun.write(filepath, content);
  return filepath;
}

/** Generate CONTRIBUTING.md with basic guidelines. */
export async function generateContributing(projectDir: string): Promise<string> {
  const filepath = join(projectDir, "CONTRIBUTING.md");
  const content = `# Contributing\n\n## Development Setup\n\n\`\`\`bash\nbun install\n\`\`\`\n\n## Pull Request Process\n\n1. Ensure tests pass: \`bun test\`\n2. Update documentation\n3. Open a PR with a clear description\n`;
  await Bun.write(filepath, content);
  return filepath;
}

/** Generate LICENSE file with given type (MIT or generic). */
export async function generateLicense(projectDir: string, type: string): Promise<string> {
  const filepath = join(projectDir, "LICENSE");
  const year = new Date().getFullYear();
  let content = "";
  if (type === "MIT") {
    content = MIT_LICENSE_TEMPLATE.replace("{{YEAR}}", String(year));
  } else {
    content = `${type} License\n\nCopyright (c) ${year}\n`;
  }
  await Bun.write(filepath, content);
  return filepath;
}

/** Generate .github/CODEOWNERS with default team placeholder. */
export async function generateCodeowners(
  projectDir: string,
  ensureDir: (dir: string) => void
): Promise<string> {
  const filepath = join(projectDir, ".github", "CODEOWNERS");
  ensureDir(join(projectDir, ".github"));
  const content = `# Code Owners\n* @team\n`;
  await Bun.write(filepath, content);
  return filepath;
}

/** Generate CHANGELOG.md with initial structure. */
export async function generateChangelog(projectDir: string): Promise<string> {
  const filepath = join(projectDir, "CHANGELOG.md");
  const content = `# Changelog\n\nAll notable changes to this project will be documented in this file.\n\n## [Unreleased]\n\n### Added\n- Initial setup\n`;
  await Bun.write(filepath, content);
  return filepath;
}

/** Scaffold a new ADR in docs/adr/ with auto-incremented number. */
export async function scaffoldAdr(
  projectDir: string,
  title: string,
  ensureDir: (dir: string) => void
): Promise<string> {
  const adrDir = join(projectDir, "docs", "adr");
  ensureDir(adrDir);

  const existing: number[] = [];
  const glob = new Bun.Glob("*.md");
  for await (const file of glob.scan({ cwd: adrDir, absolute: false })) {
    const num = parseInt(file.split("-")[0], 10);
    if (!isNaN(num)) existing.push(num);
  }
  const nextNum = (existing.length > 0 ? Math.max(...existing) : 0) + 1;
  const paddedNum = String(nextNum).padStart(4, "0");

  const slug = title
    .toLowerCase()
    .replace(/[^\w]+/g, "-")
    .replace(/^-|-$/g, "");
  const filename = `${paddedNum}-${slug}.md`;
  const filepath = join(adrDir, filename);

  const content = ADR_TEMPLATE.replace("{{DATE}}", new Date().toISOString().split("T")[0])
    .replace("{{DECIDERS}}", "@team")
    .replace("{{TITLE}}", title);

  await Bun.write(filepath, content);
  return filepath;
}

/** Key markers that must exist in scaffold-templates (drift guard). */
export const TEMPLATE_MARKERS: Record<string, string[]> = {
  OXFMTRC: ['"printWidth": 100'],
  CI_WORKFLOW: ["format:check:ci", "test:coverage:ci", "1.3.14"],
  TSCONFIG: ["moduleResolution", "bundler"],
  BUNFIG: ["concurrentTestGlob", "coverageThreshold"],
  DX_CONFIG_APP: ["dx setup", "dx cli", "dx package"],
  DX_CONFIG_TOOLCHAIN: ["[finishWork]", "[herdr]", "finish-work"],
  GITIGNORE: ["coverage/", ".bun-cache"],
  ENV_EXAMPLE: ["DATABASE_URL", "PORT=0"],
  MIT_LICENSE_TEMPLATE: ["Permission is hereby granted, free of charge", "WITHOUT WARRANTY"],
};
