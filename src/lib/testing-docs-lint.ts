/**
 * Testing documentation audit — encodes agent `rg` recipes and stale-pattern gates.
 *
 * @see test/testing.md § Doc audit
 * @see https://bun.com/docs/runtime/markdown#bun-markdown-html
 */

import { join } from "path";
import { readTextAsync } from "./bun-io.ts";
import { REQUIRED_PACKAGE_SCRIPT_ENTRIES } from "./scaffold-templates.ts";

export const BUN_MARKDOWN_HTML_DOC_URL = "https://bun.com/docs/runtime/markdown#bun-markdown-html";

/** Default agent-facing docs scanned by the gate. */
export const TESTING_DOCS_DEFAULT_PATHS = [
  "AGENTS.md",
  "README.md",
  "CONTRIBUTING.md",
  "UNIFIED.md",
  "TEMPLATES.md",
  "CODE_REFERENCES.md",
  "test/testing.md",
  "docs/references/bun-runtime-scaffold.md",
] as const;

/** Shell recipes agents can run manually (kept in sync with gate rules). */
export const TESTING_DOCS_AUDIT_COMMANDS = {
  bunTest: "rg -n --glob '*.{md,ts}' 'bun test' .",
  foreignRunnersAndTestApi: `rg -n --glob '*.{md,ts,js,json}' \\
  -e 'jest|vitest|mocha|ava|tap|jasmine' \\
  -e 'test\\\\(|it\\\\(|describe\\\\(' \\
  --ignore-case \\
  --no-ignore-vcs \\
  -g '!node_modules' -g '!dist' -g '!.git' -g '!pnpm-lock.yaml' -g '!bun.lock' \\
  .`,
  headingLowercase: "rg -n '^#{1,6}\\\\s+[a-z]' --glob '*.md' .",
  headingTrailingPunctuation: "rg -n '^#{1,6}\\\\s+.*[.!?]$' --glob '*.md' .",
  headingMissingSpace: "rg -n '^#{1,6}[^ #]' --glob '*.md' .",
  /** Optional deep audit — skipped levels, duplicates, trailing spaces, setext vs ATX. */
  markdownlintOptional: "bunx markdownlint-cli2 '**/*.md' '#node_modules'",
} as const;

export type TestingDocSeverity = "error" | "warn";

export interface TestingDocIssue {
  file: string;
  line: number;
  ruleId: string;
  severity: TestingDocSeverity;
  message: string;
  snippet: string;
}

interface LintRule {
  id: string;
  severity: TestingDocSeverity;
  pattern: RegExp;
  message: string;
  fileFilter?: RegExp;
  lineExempt?: RegExp;
}

const STALE_TEST_FAST = /run-tests\.ts --fast/;

const LINT_RULES: LintRule[] = [
  {
    id: "stale-test-fast-script",
    severity: "error",
    pattern: STALE_TEST_FAST,
    message: 'Use scripts/test-fast.ts (or package.json "test:fast") — not run-tests.ts --fast',
    fileFilter: /\.(md|ts)$/,
    lineExempt: /scripts\/run-tests\.ts/,
  },
  {
    id: "foreign-runner-vitest",
    severity: "error",
    pattern: /\bvitest\b/i,
    message: "Document bun:test — Vitest is not the repo test runner",
    fileFilter: /\.md$/,
    lineExempt: /Reject\s+`|migration away|foreignRunners|manual inventory/i,
  },
  {
    id: "foreign-runner-mocha",
    severity: "error",
    pattern: /\bmocha\b/i,
    message: "Document bun:test — Mocha is not the repo test runner",
    fileFilter: /\.md$/,
    lineExempt: /Reject\s+`|migration away|foreignRunners|manual inventory/i,
  },
  {
    id: "foreign-runner-jasmine",
    severity: "error",
    pattern: /\bjasmine\b/i,
    message: "Document bun:test — Jasmine is not the repo test runner",
    fileFilter: /\.md$/,
    lineExempt: /Reject\s+`|migration away|foreignRunners|manual inventory/i,
  },
  {
    id: "stale-check-fast-timing",
    severity: "error",
    pattern: /check:fast.*~1s|check:fast.*\(\s*~1s/i,
    message: "check:fast is ~3s (format + lint + typecheck + unit tests), not ~1s",
    fileFilter: /CONTRIBUTING\.md$/,
  },
  {
    id: "stale-full-check-timing",
    severity: "warn",
    pattern: /bun run check\b[^\n]*~4s/i,
    message: "Full check is closer to ~30s — see AGENTS.md gate table",
    fileFilter: /CONTRIBUTING\.md$/,
  },
];

const BUN_TEST_INVENTORY_ALLOW = /bun test\s*(<|--|\()/;

interface HeadingRule {
  id: string;
  severity: TestingDocSeverity;
  test: (heading: string, level: number) => boolean;
  message: string;
}

/** ATX heading rules — h1 lowercase skipped (project slugs like `# kimi-toolchain`). */
const HEADING_RULES: HeadingRule[] = [
  {
    id: "heading-lowercase-start",
    severity: "warn",
    test: (heading, level) => {
      if (level < 2) return false;
      if (/^[\w./-]+\.(json|toml|ts|md|yml|d\.ts)\b/i.test(heading)) return false;
      if (/^src\//i.test(heading)) return false;
      if (/^[a-z]+[A-Z]/.test(heading)) return false;
      return /^[a-z]/.test(heading);
    },
    message: "Heading should start with an uppercase letter (h2–h6)",
  },
  {
    id: "heading-trailing-punctuation",
    severity: "warn",
    test: (heading) => /[.!?]$/.test(heading.trim()),
    message: "Headings should not end with . ! or ?",
  },
  {
    id: "heading-missing-space",
    severity: "error",
    test: () => false,
    message: "ATX headings need a space after # characters",
  },
];

/** Collect ATX heading lines outside fenced code blocks. */
export function listMarkdownHeadings(
  text: string
): Array<{ line: number; level: number; title: string; raw: string }> {
  const lines = text.split("\n");
  const hits: Array<{ line: number; level: number; title: string; raw: string }> = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const trimmed = raw.trim();
    if (/^```/.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const missingSpace = raw.match(/^(#{1,6})([^ #\s].*)$/);
    if (missingSpace) {
      hits.push({
        line: i + 1,
        level: missingSpace[1]!.length,
        title: missingSpace[2]!.trim(),
        raw,
      });
      continue;
    }

    const m = raw.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!m) continue;
    hits.push({
      line: i + 1,
      level: m[1]!.length,
      title: m[2]!.trim(),
      raw,
    });
  }
  return hits;
}

export function auditMarkdownHeadings(rel: string, text: string): TestingDocIssue[] {
  if (!/\.md$/.test(rel)) return [];
  const issues: TestingDocIssue[] = [];
  for (const hit of listMarkdownHeadings(text)) {
    if (/^(#{1,6})([^ #\s].*)$/.test(hit.raw.trim())) {
      issues.push({
        file: rel,
        line: hit.line,
        ruleId: "heading-missing-space",
        severity: "error",
        message: HEADING_RULES.find((r) => r.id === "heading-missing-space")!.message,
        snippet: hit.raw.trim().slice(0, 140),
      });
      continue;
    }
    for (const rule of HEADING_RULES) {
      if (rule.id === "heading-missing-space") continue;
      if (!rule.test(hit.title, hit.level)) continue;
      issues.push({
        file: rel,
        line: hit.line,
        ruleId: rule.id,
        severity: rule.severity,
        message: rule.message,
        snippet: hit.raw.trim().slice(0, 140),
      });
    }
  }
  return issues;
}

function scanLine(
  rel: string,
  lineNo: number,
  raw: string,
  rule: LintRule
): TestingDocIssue | undefined {
  if (rule.fileFilter && !rule.fileFilter.test(rel)) return undefined;
  if (rule.lineExempt?.test(raw)) return undefined;
  const line = raw.replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/'(?:\\.|[^'\\])*'/g, "''");
  if (!rule.pattern.test(line)) return undefined;
  return {
    file: rel,
    line: lineNo,
    ruleId: rule.id,
    severity: rule.severity,
    message: rule.message,
    snippet: raw.trim().slice(0, 140),
  };
}

function scanText(rel: string, text: string): TestingDocIssue[] {
  const issues: TestingDocIssue[] = [];
  const lines = text.split("\n");
  for (const rule of LINT_RULES) {
    for (let i = 0; i < lines.length; i++) {
      const hit = scanLine(rel, i + 1, lines[i] ?? "", rule);
      if (hit) issues.push(hit);
    }
  }
  return issues;
}

/** Inventory `bun test` mentions in agent docs (allowed + flagged). */
export function inventoryBunTestMentions(
  rel: string,
  text: string
): Array<{ line: number; allowed: boolean; snippet: string }> {
  if (!/\.md$/.test(rel)) return [];
  const hits: Array<{ line: number; allowed: boolean; snippet: string }> = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    if (!/bun test/.test(raw)) continue;
    hits.push({
      line: i + 1,
      allowed:
        BUN_TEST_INVENTORY_ALLOW.test(raw) ||
        /Avoid in CI|do not|Do not|anti-pattern|hooks\/CI|Bare `bun test`/i.test(raw),
      snippet: raw.trim().slice(0, 140),
    });
  }
  return hits;
}

/** TEMPLATES.md package.json block must match scaffold SSOT for test:fast. */
export async function auditTemplatesTestFastParity(
  root: string
): Promise<TestingDocIssue | undefined> {
  const templatesPath = join(root, "TEMPLATES.md");
  const text = await readTextAsync(templatesPath);
  const expected = REQUIRED_PACKAGE_SCRIPT_ENTRIES["test:fast"];
  const lines = text.split("\n");
  let lineNo = 0;
  let value: string | undefined;
  let snippet = "";
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]?.match(/"test:fast":\s*"([^"]+)"/);
    if (!m) continue;
    lineNo = i + 1;
    value = m[1];
    snippet = lines[i]!.trim();
    break;
  }
  if (!value) {
    return {
      file: "TEMPLATES.md",
      line: 0,
      ruleId: "templates-missing-test-fast",
      severity: "error",
      message: 'TEMPLATES.md package.json block is missing "test:fast"',
      snippet: "",
    };
  }
  if (value !== expected) {
    return {
      file: "TEMPLATES.md",
      line: lineNo,
      ruleId: "templates-test-fast-drift",
      severity: "error",
      message: `TEMPLATES.md test:fast must match scaffold-templates.ts: "${expected}"`,
      snippet,
    };
  }
  return undefined;
}

export async function auditTestingDocs(
  root: string,
  paths?: readonly string[]
): Promise<TestingDocIssue[]> {
  const targets = paths?.length ? paths : [...TESTING_DOCS_DEFAULT_PATHS];
  const issues: TestingDocIssue[] = [];

  for (const rel of targets) {
    const abs = join(root, rel);
    let text: string;
    try {
      text = await readTextAsync(abs);
    } catch {
      continue;
    }
    issues.push(...scanText(rel, text));
    issues.push(...auditMarkdownHeadings(rel, text));
  }

  // Scaffold parity + repo-wide stale script scan (scaffold injectors).
  for (const rel of ["src/lib/scaffold-templates.ts", "src/lib/scaffold-quality.ts"] as const) {
    const text = await readTextAsync(join(root, rel));
    issues.push(...scanText(rel, text));
  }

  const parity = await auditTemplatesTestFastParity(root);
  if (parity) issues.push(parity);

  return issues;
}

export function formatTestingDocIssue(issue: TestingDocIssue): string {
  return `${issue.file}:${issue.line} [${issue.ruleId}] ${issue.message}`;
}

export function formatTestingDocReport(issues: TestingDocIssue[]): string {
  const errors = issues.filter((i) => i.severity === "error");
  const warns = issues.filter((i) => i.severity === "warn");
  if (issues.length === 0) return "testing-docs: ok";
  const lines = [`testing-docs: ${errors.length} error(s), ${warns.length} warning(s)`];
  for (const issue of issues) {
    lines.push(`  ${formatTestingDocIssue(issue)}`);
    if (issue.snippet) lines.push(`    ${issue.snippet}`);
  }
  return lines.join("\n");
}
