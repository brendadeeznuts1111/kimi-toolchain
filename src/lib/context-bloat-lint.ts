/**
 * Agent-facing doc hygiene — broken links, stale paths, CONTEXT placeholders.
 */

import { readableStreamToText } from "./bun-utils.ts";
import { pathExists } from "./bun-io.ts";

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

/** Index docs that should link to active docs/ markdown (orphan detection). */
export const DOC_INDEX_FILES = [
  "README.md",
  "AGENTS.md",
  "UNIFIED.md",
  "CODE_REFERENCES.md",
] as const;

/** Known template literals copied into agent docs — duplicates indicate unfilled bloat. */
export const AGENT_DOC_PLACEHOLDER_STRINGS = [
  "[High-level diagram or description of layers/data flow]",
  "[Anything else an agent needs to know: conventions, gotchas, tribal knowledge]",
] as const;

/** Bracket placeholders that look like unfilled template instructions. */
export const AGENT_DOC_PLACEHOLDER_RE =
  /\[(?:Add |Auto-generated\.|High-level |Anything else |Replace )[^\]]+\]/g;

/** AGENTS.md Architecture tree — claimed registered bin count. */
export const AGENTS_BIN_COUNT_RE = /CLI entry points \((\d+) registered bins/;

/** Bins routed via kimi-toolchain or bun run — intentionally omitted from package.json bin. */
export const SOURCE_ONLY_BIN_FILES = [
  "herdr-doctor.ts",
  "herdr-latm.ts",
  "herdr-orchestrator.ts",
  "herdr-pane.ts",
  "herdr-project.ts",
  "herdr-spawn.ts",
  "kimi-bake.ts",
  "kimi-config.ts",
  "kimi-dashboard.ts",
  "kimi-identity.ts",
] as const;

export const AGENTS_MAX_LINES = 900;
export const CONTEXT_MAX_LINES = 120;

const SKIP_DIRS = new Set(["node_modules", ".git", "coverage", ".bun"]);
const LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g;
/** Backtick repo paths in agent docs — must exist on disk. */
const BARE_REPO_PATH_RE = /`((?:src|test|scripts)\/[^\s`]+)`/g;

const BARE_PATH_SKIP_SUFFIXES = [".example", "…", "...", "*"];

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
  if (rel.startsWith("templates/scaffold/") && rel.endsWith(".md")) return true;
  return false;
}

/** Scaffold templates cite hypothetical project paths — skip bare-path existence checks. */
export function shouldCheckBareRepoPaths(rel: string): boolean {
  if (rel.startsWith("templates/scaffold/")) return false;
  return isAgentFacingDoc(rel);
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
    // Portable home paths in synced skills — not repo-relative link targets.
    if (clean.startsWith("~/")) continue;

    const resolved = resolve(dir, clean);
    if (!pathExists(resolved)) {
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

function isConcreteRepoPath(raw: string): boolean {
  if (raw.includes("{") || raw.includes("}") || raw.includes("*")) return false;
  if (raw.endsWith("/")) return false;
  if (BARE_PATH_SKIP_SUFFIXES.some((s) => raw.includes(s))) return false;
  const pathPart = raw.split(":")[0]!;
  return /\.(?:ts|md|sh|toml|json)$/.test(pathPart);
}

export function findBareRepoPathRefs(
  projectRoot: string,
  rel: string,
  text: string
): ContextBloatIssue[] {
  const issues: ContextBloatIssue[] = [];

  for (const match of text.matchAll(BARE_REPO_PATH_RE)) {
    const raw = match[1]?.trim();
    if (!raw || !isConcreteRepoPath(raw)) continue;
    if (raw.includes("~") || raw.startsWith("http")) continue;

    const pathPart = raw.split(":")[0]!;
    const candidates = [join(projectRoot, pathPart)];
    if (pathExists(candidates[0]!)) continue;

    const idx = match.index ?? 0;
    issues.push({
      file: rel,
      line: lineNumber(text, idx),
      rule: "bare-path-missing",
      message: `Backtick path "${pathPart}" does not exist`,
      severity: "error",
    });
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

export function findOversizedAgentDocs(rel: string, text: string): ContextBloatIssue[] {
  const lineCount = text.split("\n").length;
  if (rel === "AGENTS.md" && lineCount > AGENTS_MAX_LINES) {
    return [
      {
        file: rel,
        line: 1,
        rule: "oversized-agent-doc",
        message: `AGENTS.md has ${lineCount} lines (limit ${AGENTS_MAX_LINES}) — split or archive sections`,
        severity: "warn",
      },
    ];
  }
  if (rel === "CONTEXT.md" && lineCount > CONTEXT_MAX_LINES) {
    return [
      {
        file: rel,
        line: 1,
        rule: "oversized-agent-doc",
        message: `CONTEXT.md has ${lineCount} lines (limit ${CONTEXT_MAX_LINES}) — tighten domain notes`,
        severity: "warn",
      },
    ];
  }
  return [];
}

/** Active docs/ markdown not linked from README, AGENTS, UNIFIED, or CODE_REFERENCES. */
export function isDocReferencedFromIndex(rel: string, indexText: string): boolean {
  if (indexText.includes(rel)) return true;

  const base = rel.split("/").pop() ?? rel;
  if (indexText.includes(`(${rel})`) || indexText.includes(`(${base})`)) return true;
  if (indexText.includes(`\`${rel}\``) || indexText.includes(`\`${base}\``)) return true;

  const parent = rel.includes("/") ? `${rel.slice(0, rel.lastIndexOf("/") + 1)}` : "";
  // Only match nested dirs (e.g. docs/adr/), not the generic docs/ prefix.
  if (parent && parent !== "docs/" && indexText.includes(parent)) return true;

  return false;
}

export function findOrphanAgentDocs(activeDocs: string[], indexText: string): ContextBloatIssue[] {
  const issues: ContextBloatIssue[] = [];
  for (const rel of activeDocs) {
    if (!rel.startsWith("docs/") || rel.startsWith("docs/plans/archive/")) continue;
    // dx-table / dx:property-table outputs — indexed by docs/table-*.md in CODE_REFERENCES
    if (rel.startsWith("docs/table-") && rel.endsWith(".md")) continue;
    if (rel.startsWith("docs/groups/table-") && rel.endsWith(".md")) continue;
    if (rel.startsWith("docs/describe/table-") && rel.endsWith(".md")) continue;
    if (rel === "docs/dx-table.md" || rel === "schemas/README.md") continue;
    if (isDocReferencedFromIndex(rel, indexText)) continue;
    issues.push({
      file: rel,
      line: 1,
      rule: "orphan-agent-doc",
      message: `Not referenced from ${DOC_INDEX_FILES.join(", ")} — link or archive`,
      severity: "error",
    });
  }
  return issues;
}

function collectPlaceholderHits(
  rel: string,
  text: string
): Array<{ placeholder: string; line: number }> {
  const hits: Array<{ placeholder: string; line: number }> = [];
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const known of AGENT_DOC_PLACEHOLDER_STRINGS) {
      if (line.includes(known)) {
        hits.push({ placeholder: known, line: i + 1 });
      }
    }
    for (const match of line.matchAll(AGENT_DOC_PLACEHOLDER_RE)) {
      const placeholder = match[0];
      if (!placeholder) continue;
      if (AGENT_DOC_PLACEHOLDER_STRINGS.some((known) => known === placeholder)) continue;
      hits.push({ placeholder, line: i + 1 });
    }
  }

  return hits;
}

/** Same unfilled template placeholder in 2+ agent-facing docs. */
export function findDuplicatePlaceholders(
  docs: Array<{ rel: string; text: string }>
): ContextBloatIssue[] {
  const byPlaceholder = new Map<string, Array<{ file: string; line: number }>>();

  for (const { rel, text } of docs) {
    for (const hit of collectPlaceholderHits(rel, text)) {
      const bucket = byPlaceholder.get(hit.placeholder) ?? [];
      bucket.push({ file: rel, line: hit.line });
      byPlaceholder.set(hit.placeholder, bucket);
    }
  }

  const issues: ContextBloatIssue[] = [];
  for (const [placeholder, occurrences] of byPlaceholder) {
    const files = new Set(occurrences.map((o) => o.file));
    if (files.size < 2) continue;
    for (const { file, line } of occurrences) {
      issues.push({
        file,
        line,
        rule: "duplicate-placeholder",
        message: `Placeholder "${placeholder}" appears in ${files.size} agent docs — fill or dedupe`,
        severity: "error",
      });
    }
  }

  return issues.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

export async function listSrcBinFiles(projectRoot: string): Promise<string[]> {
  const binDir = join(projectRoot, "src/bin");
  if (!pathExists(binDir)) return [];
  const glob = new Bun.Glob("*.ts");
  const files: string[] = [];
  for await (const name of glob.scan({ cwd: binDir, onlyFiles: true })) {
    files.push(name);
  }
  return files.sort();
}

/** AGENTS.md claimed bin count vs actual src/bin/*.ts files. */
export function findBinCountDrift(agentsText: string, actualBinCount: number): ContextBloatIssue[] {
  const match = agentsText.match(AGENTS_BIN_COUNT_RE);
  if (!match || match.index === undefined) {
    return [
      {
        file: "AGENTS.md",
        line: 1,
        rule: "bin-count-drift",
        message: 'Missing "CLI entry points (N registered bins)" claim in Architecture tree',
        severity: "error",
      },
    ];
  }

  const claimed = Number.parseInt(match[1]!, 10);
  if (!Number.isFinite(claimed) || claimed !== actualBinCount) {
    return [
      {
        file: "AGENTS.md",
        line: lineNumber(agentsText, match.index),
        rule: "bin-count-drift",
        message: `Claims ${claimed} registered bins but src/bin/*.ts has ${actualBinCount} — update AGENTS.md`,
        severity: "error",
      },
    ];
  }

  return [];
}

/** package.json bin entries must map 1:1 to src/bin/*.ts. */
export function findPackageBinDrift(
  packageBins: Record<string, string>,
  srcBinFiles: string[],
  sourceOnlyFiles: readonly string[] = SOURCE_ONLY_BIN_FILES
): ContextBloatIssue[] {
  const issues: ContextBloatIssue[] = [];
  const sourceOnlySet = new Set(sourceOnlyFiles);
  const actualPaths = new Set(srcBinFiles.map((f) => `src/bin/${f}`));
  const registeredPaths = new Set(Object.values(packageBins));

  for (const [name, target] of Object.entries(packageBins)) {
    if (!actualPaths.has(target)) {
      issues.push({
        file: "package.json",
        line: 1,
        rule: "package-bin-drift",
        message: `bin "${name}" points to missing "${target}"`,
        severity: "error",
      });
    }
  }

  for (const file of srcBinFiles) {
    if (sourceOnlySet.has(file)) continue;
    const relPath = `src/bin/${file}`;
    if (!registeredPaths.has(relPath)) {
      issues.push({
        file: "package.json",
        line: 1,
        rule: "package-bin-drift",
        message: `"${relPath}" exists but is not registered in package.json bin`,
        severity: "error",
      });
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
  const stdout = await readableStreamToText(proc.stdout);
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function auditMarkdownText(
  projectRoot: string,
  rel: string,
  text: string
): ContextBloatIssue[] {
  return [
    ...findStaleDocPathRefs(rel, text),
    ...findBrokenInternalLinks(projectRoot, rel, text),
    ...(shouldCheckBareRepoPaths(rel) ? findBareRepoPathRefs(projectRoot, rel, text) : []),
    ...findContextPlaceholders(rel, text),
    ...findOversizedAgentDocs(rel, text),
  ];
}

export async function auditMarkdownFile(
  projectRoot: string,
  rel: string
): Promise<ContextBloatIssue[]> {
  const path = join(projectRoot, rel);
  const text = await Bun.file(path).text();
  return auditMarkdownText(projectRoot, rel, text);
}

async function readIndexDocText(projectRoot: string): Promise<string> {
  const chunks: string[] = [];
  for (const rel of DOC_INDEX_FILES) {
    const path = join(projectRoot, rel);
    if (!pathExists(path)) continue;
    chunks.push(await Bun.file(path).text());
  }
  return chunks.join("\n");
}

export async function auditContextBloat(projectRoot: string): Promise<ContextBloatIssue[]> {
  const glob = new Bun.Glob("**/*.md");
  const issues: ContextBloatIssue[] = [];
  const agentDocs: Array<{ rel: string; text: string }> = [];
  const activeDocPaths: string[] = [];

  for await (const rel of glob.scan({ cwd: projectRoot, onlyFiles: true })) {
    if (!isAgentFacingDoc(rel)) continue;
    const text = await Bun.file(join(projectRoot, rel)).text();
    agentDocs.push({ rel, text });
    if (rel.startsWith("docs/") && !rel.startsWith("docs/plans/archive/")) {
      activeDocPaths.push(rel);
    }
    issues.push(...auditMarkdownText(projectRoot, rel, text));
  }

  const indexText = await readIndexDocText(projectRoot);
  issues.push(...findOrphanAgentDocs(activeDocPaths, indexText));
  issues.push(...findDuplicatePlaceholders(agentDocs));

  const srcBinFiles = await listSrcBinFiles(projectRoot);
  const packagePath = join(projectRoot, "package.json");
  const pkg = pathExists(packagePath)
    ? ((await Bun.file(packagePath).json()) as { bin?: Record<string, string> })
    : undefined;
  const agentsPath = join(projectRoot, "AGENTS.md");
  if (pathExists(agentsPath)) {
    const agentsText = await Bun.file(agentsPath).text();
    const registeredCount = pkg?.bin ? Object.keys(pkg.bin).length : srcBinFiles.length;
    issues.push(...findBinCountDrift(agentsText, registeredCount));
  }

  if (pkg?.bin) {
    issues.push(...findPackageBinDrift(pkg.bin, srcBinFiles));
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
