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
