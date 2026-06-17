/**
 * Agent-facing doc hygiene — broken links, stale paths, CONTEXT placeholders.
 */

import { existsSync } from "fs";
import { dirname, join, resolve } from "path";

export interface ContextBloatIssue {
  file: string;
  line: number;
  rule: string;
  message: string;
  severity: "error" | "warn";
}

/** Plans relocated under docs/plans/archive/ — references must use the new path. */
export const MOVED_DOC_PATHS: Record<string, string> = {
  "docs/dx-cloudflare-integration-plan.md": "docs/plans/archive/dx-cloudflare-integration-plan.md",
  "docs/dx-homepage-dashboard-plan.md": "docs/plans/archive/dx-homepage-dashboard-plan.md",
  "docs/phase-5-config-lifecycle-plan.md": "docs/plans/archive/phase-5-config-lifecycle-plan.md",
};

export const CONTEXT_PLACEHOLDER_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  {
    pattern: /\[Auto-generated\. Describe what this project does/,
    label: "CONTEXT Domain placeholder — run kimi-context-gen update after filling template",
  },
  {
    pattern: /\[Add domain-specific notes/,
    label: "CONTEXT Notes placeholder — add project-specific notes or tighten context-gen",
  },
];

const SKIP_DIRS = new Set(["node_modules", ".git", "coverage", ".bun"]);
const LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g;

const ROOT_AGENT_DOCS = new Set([
  "README.md",
  "AGENTS.md",
  "CONTEXT.md",
  "CODE_REFERENCES.md",
  "UNIFIED.md",
  "TEMPLATES.md",
  "DEEP-QUALITY.md",
]);

/** Docs scanned for link integrity and stale path references. */
export function isAgentFacingDoc(rel: string): boolean {
  if (rel.split("/").some((seg) => SKIP_DIRS.has(seg))) return false;
  if (ROOT_AGENT_DOCS.has(rel)) return true;
  if (rel.startsWith("skills/") && rel.endsWith(".md")) return true;
  if (rel.startsWith("docs/") && rel.endsWith(".md") && !rel.startsWith("docs/plans/archive/")) {
    return true;
  }
  return false;
}

function lineNumber(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

export function findStaleDocPathRefs(rel: string, text: string): ContextBloatIssue[] {
  const issues: ContextBloatIssue[] = [];
  for (const [stale, replacement] of Object.entries(MOVED_DOC_PATHS)) {
    let from = 0;
    while (true) {
      const idx = text.indexOf(stale, from);
      if (idx === -1) break;
      issues.push({
        file: rel,
        line: lineNumber(text, idx),
        rule: "stale-doc-path",
        message: `Reference "${stale}" moved — use "${replacement}"`,
        severity: "error",
      });
      from = idx + stale.length;
    }
  }
  return issues;
}

export function findBrokenInternalLinks(
  projectRoot: string,
  rel: string,
  text: string
): ContextBloatIssue[] {
  const issues: ContextBloatIssue[] = [];
  const dir = dirname(join(projectRoot, rel));

  for (const match of text.matchAll(LINK_RE)) {
    const target = match[2]?.trim();
    if (!target) continue;
    if (
      target.startsWith("http://") ||
      target.startsWith("https://") ||
      target.startsWith("#") ||
      target.startsWith("mailto:")
    ) {
      continue;
    }

    const clean = target.split("#")[0]?.split("?")[0]?.trim();
    if (!clean || clean.startsWith("<")) continue;

    const resolved = resolve(dir, clean);
    if (!existsSync(resolved)) {
      const idx = match.index ?? 0;
      issues.push({
        file: rel,
        line: lineNumber(text, idx),
        rule: "broken-internal-link",
        message: `Broken link target "${clean}" (${match[0]})`,
        severity: "error",
      });
    }
  }

  return issues;
}

export function findContextPlaceholders(rel: string, text: string): ContextBloatIssue[] {
  if (rel !== "CONTEXT.md") return [];
  const issues: ContextBloatIssue[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const { pattern, label } of CONTEXT_PLACEHOLDER_PATTERNS) {
      if (pattern.test(line)) {
        issues.push({
          file: rel,
          line: i + 1,
          rule: "context-placeholder",
          message: label,
          severity: "error",
        });
      }
    }
  }
  return issues;
}

export async function listTrackedBackupFiles(projectRoot: string): Promise<string[]> {
  const proc = Bun.spawn(["git", "ls-files", "*.bak", "CONTEXT.md.bak"], {
    cwd: projectRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) return [];
  const stdout = await Bun.readableStreamToText(proc.stdout);
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function auditMarkdownFile(
  projectRoot: string,
  rel: string
): Promise<ContextBloatIssue[]> {
  const path = join(projectRoot, rel);
  const text = await Bun.file(path).text();
  return [
    ...findStaleDocPathRefs(rel, text),
    ...findBrokenInternalLinks(projectRoot, rel, text),
    ...findContextPlaceholders(rel, text),
  ];
}

export async function auditContextBloat(projectRoot: string): Promise<ContextBloatIssue[]> {
  const glob = new Bun.Glob("**/*.md");
  const issues: ContextBloatIssue[] = [];

  for await (const rel of glob.scan({ cwd: projectRoot, onlyFiles: true })) {
    if (!isAgentFacingDoc(rel)) continue;
    issues.push(...(await auditMarkdownFile(projectRoot, rel)));
  }

  for (const tracked of await listTrackedBackupFiles(projectRoot)) {
    issues.push({
      file: tracked,
      line: 1,
      rule: "tracked-backup",
      message: "Backup file is git-tracked — remove and rely on .gitignore *.bak",
      severity: "error",
    });
  }

  return issues.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

export function formatContextBloatReport(issues: ContextBloatIssue[]): string {
  if (issues.length === 0) return "lint:context-bloat OK";
  const errors = issues.filter((i) => i.severity === "error");
  const warns = issues.filter((i) => i.severity === "warn");
  const lines = [`context-bloat: ${errors.length} error(s), ${warns.length} warn(s)`];
  for (const issue of issues) {
    const mark = issue.severity === "error" ? "✗" : "⚠";
    lines.push(`  ${mark} ${issue.file}:${issue.line} [${issue.rule}] ${issue.message}`);
  }
  return lines.join("\n");
}
