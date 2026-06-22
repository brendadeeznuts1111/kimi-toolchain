#!/usr/bin/env bun
/**
 * check-docs.ts — Verify .md files follow style guide conventions
 * Usage: bun scripts/check-docs.ts [directory] [--fix] [--json]
 * Exit code: number of errors (0 = clean)
 *
 * Modes:
 *   (default)  Print color-coded report with Bun.inspect.table
 *   --fix      Auto-add missing frontmatter and ## Related sections
 *   --json     Output machine-readable JSON for CI/dashboards
 *
 * Color coding (HSL → HEX, via Bun.color()):
 *   ERROR  red     hsl(0,80%,55%)   #E63946
 *   WARN   amber   hsl(35,90%,55%)  #F4A024
 *   INFO   blue    hsl(210,70%,60%) #4DA6FF
 *   OK     green   hsl(145,60%,50%) #33CC66
 *   DIM    gray    hsl(0,0%,50%)    #808080
 *   HEADER cyan    hsl(195,80%,55%) #3399FF
 *
 * Color logic follows the same pattern as src/lib/cli-format.ts:
 *   - Uses Bun.color(hex, "ansi") for ANSI output
 *   - Suppresses colors when stdout is not a TTY
 */

import { Glob } from "bun";

// ─── CLI arg parsing ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positional = args.filter((a) => !a.startsWith("--"));

const root = positional[0] ?? ".";
const FIX_MODE = flags.has("--fix");
const JSON_MODE = flags.has("--json");

// ─── Config ───────────────────────────────────────────────────────────────────

const SKIP_PATTERNS = [
  /node_modules\//,
  /\.kimi-artifacts\//,
  /\.git\//,
  /\.bun\//,
  /bun-install\//,
  /\.cache\//,
  /\/dist\//,
  /\/build\//,
];

const CATEGORY_ORDER = [
  "root",
  "core",
  "adr",
  "references",
  "plans",
  "canvases",
  "sub-tables",
  "examples",
  "skills",
  "templates",
  "schemas",
  "test",
  "src",
  "other",
] as const;

const ROOT_FILES = new Set([
  "README.md",
  "AGENTS.md",
  "CHANGELOG.md",
  "CODE_REFERENCES.md",
  "CONTEXT.md",
  "CONTRIBUTING.md",
  "DEEP-QUALITY.md",
  "MACROS.md",
  "TEMPLATES.md",
  "UNIFIED.md",
  "INDEX.md",
]);

// ─── Types ────────────────────────────────────────────────────────────────────

type Severity = "ERROR" | "WARN" | "INFO";

interface Issue {
  file: string;
  category: string;
  severity: Severity;
  message: string;
  issueType: string;
  fixed?: boolean;
}

interface CategoryStats {
  files: number;
  errors: number;
  warnings: number;
}

interface JsonReport {
  summary: {
    totalFiles: number;
    cleanFiles: number;
    totalErrors: number;
    totalWarnings: number;
    fixed: number;
  };
  issues: Issue[];
  issuesByType: Record<string, number>;
  categories: Array<{ name: string; files: number; errors: number; warnings: number }>;
}

// ─── Color helpers (aligned with cli-format.ts pattern) ───────────────────────

const HEX = {
  ERROR: "#E63946",
  WARN: "#F4A024",
  INFO: "#4DA6FF",
  OK: "#33CC66",
  DIM: "#808080",
  BOLD: "#FFFFFF",
  HEADER: "#3399FF",
} as const;

function useColor(): boolean {
  return process.stdout.isTTY === true;
}

function paint(text: string, hex: string): string {
  if (!useColor()) return text;
  return `${Bun.color(hex, "ansi")}${text}\x1b[0m`;
}

function paintBold(text: string, hex: string): string {
  if (!useColor()) return text;
  return `\x1b[1m${Bun.color(hex, "ansi")}${text}\x1b[0m`;
}

function severityPaint(s: Severity): string {
  return s === "ERROR" ? HEX.ERROR : s === "WARN" ? HEX.WARN : HEX.INFO;
}

function severityIcon(s: Severity): string {
  return s === "ERROR" ? "✗" : s === "WARN" ? "⚠" : "ℹ";
}

// ─── Categorization ───────────────────────────────────────────────────────────

function getCategory(filePath: string): string {
  const rel = filePath.replace(/^\.\//, "");
  const parts = rel.split("/");

  if (parts.length === 1 && ROOT_FILES.has(parts[0]!)) return "root";
  if (parts[0] === "docs") {
    if (parts[1] === "adr") return "adr";
    if (parts[1] === "references") return "references";
    if (parts[1] === "plans") return "plans";
    if (parts[1] === "canvases") return "canvases";
    if (parts[1] === "describe") return "sub-tables";
    if (parts[1] === "groups") return "sub-tables";
    return "core";
  }
  if (parts[0] === "examples") return "examples";
  if (parts[0] === "skills") return "skills";
  if (parts[0] === "templates") return "templates";
  if (parts[0] === "schemas") return "schemas";
  if (parts[0] === "test") return "test";
  if (parts[0] === "src") return "src";
  return "other";
}

function shouldSkip(filePath: string): boolean {
  return SKIP_PATTERNS.some((p) => p.test(filePath));
}

// ─── Frontmatter generation ───────────────────────────────────────────────────

function inferTitle(filePath: string): string {
  const name = filePath.replace(/^\.\//, "").replace(/\.md$/, "");
  const base = name.split("/").pop() ?? name;
  return base
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/^ADR/, "ADR");
}

function inferTags(filePath: string): string[] {
  const cat = getCategory(filePath);
  const name = filePath.replace(/^\.\//, "").replace(/\.md$/, "");
  const base = name.split("/").pop() ?? name;
  const tags = new Set<string>();

  tags.add(cat);
  if (cat === "adr") tags.add("adr");
  if (cat === "references") tags.add("reference");
  if (cat === "examples") tags.add("examples");
  if (base.includes("bun")) tags.add("bun");
  if (base.includes("macro")) tags.add("macros");
  if (base.includes("secret")) tags.add("secrets");
  if (base.includes("scanner")) tags.add("scanner");
  if (base.includes("security")) tags.add("security");
  if (base.includes("dashboard")) tags.add("dashboard");
  if (base.includes("herdr")) tags.add("herdr");
  if (base.includes("effect")) tags.add("effect");
  if (base.includes("gates")) tags.add("gates");
  if (base.includes("portal")) tags.add("portal");
  if (base.includes("artifact")) tags.add("artifacts");

  return [...tags].slice(0, 5);
}

function inferCategoryValue(filePath: string): string {
  const cat = getCategory(filePath);
  if (cat === "root" || cat === "core" || cat === "examples" || cat === "meta") return cat;
  if (cat === "adr" || cat === "references" || cat === "plans") return "core";
  if (cat === "skills" || cat === "templates" || cat === "schemas" || cat === "canvases") return "meta";
  if (cat === "sub-tables" || cat === "test" || cat === "src") return "core";
  return "core";
}

function generateFrontmatter(filePath: string): string {
  const title = inferTitle(filePath);
  const tags = inferTags(filePath);
  const category = inferCategoryValue(filePath);
  return [
    "---",
    `title: "${title}"`,
    `tags: [${tags.join(", ")}]`,
    `category: ${category}`,
    `status: draft`,
    `priority: medium`,
    "---",
    "",
  ].join("\n");
}

function generateRelated(filePath: string): string {
  return "\n## Related\n\n- [INDEX.md](../INDEX.md) — Documentation index\n";
}

// ─── File checks ──────────────────────────────────────────────────────────────

async function checkFile(filePath: string): Promise<Issue[]> {
  const issues: Issue[] = [];
  const content = await Bun.file(filePath).text();
  const lines = content.split("\n");
  const category = getCategory(filePath);

  if (lines[0]?.trim() !== "---") {
    issues.push({ file: filePath, category, severity: "ERROR", message: "missing frontmatter (---)", issueType: "frontmatter" });
  }

  if (!lines.some((l) => /^##\s+Related/.test(l))) {
    issues.push({ file: filePath, category, severity: "ERROR", message: "missing '## Related' section", issueType: "related" });
  }

  if (!/^tags:/m.test(content)) {
    issues.push({ file: filePath, category, severity: "WARN", message: "missing 'tags' in frontmatter", issueType: "tags" });
  }

  if (!/^category:/m.test(content)) {
    issues.push({ file: filePath, category, severity: "WARN", message: "missing 'category' in frontmatter", issueType: "category" });
  }

  if (!/#find:/.test(content)) {
    issues.push({ file: filePath, category, severity: "INFO", message: "has no #find: anchor (optional)", issueType: "find" });
  }

  return issues;
}

// ─── Fix logic ────────────────────────────────────────────────────────────────

async function fixFile(filePath: string, issues: Issue[]): Promise<number> {
  let content = await Bun.file(filePath).text();
  let fixed = 0;

  const hasFrontmatter = issues.some((i) => i.issueType === "frontmatter");
  const hasRelated = issues.some((i) => i.issueType === "related");
  const hasTags = issues.some((i) => i.issueType === "tags");
  const hasCategory = issues.some((i) => i.issueType === "category");

  if (hasFrontmatter) {
    const fm = generateFrontmatter(filePath);
    content = fm + content;
    fixed++;
  } else if (hasTags || hasCategory) {
    // Inject missing fields into existing frontmatter
    const lines = content.split("\n");
    const fmEnd = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
    if (fmEnd > 0) {
      const insertLines: string[] = [];
      if (hasTags) {
        const tags = inferTags(filePath);
        insertLines.push(`tags: [${tags.join(", ")}]`);
      }
      if (hasCategory) {
        insertLines.push(`category: ${inferCategoryValue(filePath)}`);
      }
      lines.splice(fmEnd, 0, ...insertLines);
      content = lines.join("\n");
      fixed += insertLines.length;
    }
  }

  if (hasRelated) {
    content = content.trimEnd() + generateRelated(filePath);
    fixed++;
  }

  if (fixed > 0) {
    await Bun.write(filePath, content);
  }

  return fixed;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const glob = new Glob("**/*.md");
  const allFiles: string[] = [];
  for await (const path of glob.scan({ cwd: root, absolute: false })) {
    const full = root === "." ? `./${path}` : `${root}/${path}`;
    if (!shouldSkip(full)) {
      allFiles.push(full);
    }
  }
  allFiles.sort();

  // Check all files
  const allIssues: Issue[] = [];
  for (const f of allFiles) {
    const issues = await checkFile(f);
    allIssues.push(...issues);
  }

  // Fix mode
  let totalFixed = 0;
  if (FIX_MODE) {
    const fixableIssues = allIssues.filter(
      (i) => i.issueType === "frontmatter" || i.issueType === "related" || i.issueType === "tags" || i.issueType === "category"
    );
    const filesToFix = new Map<string, Issue[]>();
    for (const issue of fixableIssues) {
      if (!filesToFix.has(issue.file)) filesToFix.set(issue.file, []);
      filesToFix.get(issue.file)!.push(issue);
    }

    for (const [file, issues] of filesToFix) {
      const fixed = await fixFile(file, issues);
      totalFixed += fixed;
      for (const issue of issues) {
        issue.fixed = true;
      }
    }
  }

  // Aggregate stats
  const catStats: Record<string, CategoryStats> = {};
  const issueTypeCounts: Record<string, number> = {};
  const filesWithIssues = new Set<string>();

  for (const f of allFiles) {
    const cat = getCategory(f);
    if (!catStats[cat]) catStats[cat] = { files: 0, errors: 0, warnings: 0 };
    catStats[cat]!.files++;
  }

  for (const issue of allIssues) {
    if (!catStats[issue.category]) catStats[issue.category] = { files: 0, errors: 0, warnings: 0 };
    if (issue.severity === "ERROR" && !issue.fixed) catStats[issue.category]!.errors++;
    if (issue.severity === "WARN" && !issue.fixed) catStats[issue.category]!.warnings++;

    issueTypeCounts[issue.issueType] = (issueTypeCounts[issue.issueType] ?? 0) + 1;
    if (!issue.fixed && issue.severity !== "INFO") filesWithIssues.add(issue.file);
  }

  const totalFiles = allFiles.length;
  const totalErrors = allIssues.filter((i) => i.severity === "ERROR" && !i.fixed).length;
  const totalWarnings = allIssues.filter((i) => i.severity === "WARN" && !i.fixed).length;
  const totalClean = allFiles.filter((f) => !filesWithIssues.has(f)).length;

  // ─── JSON mode ──────────────────────────────────────────────────────────────

  if (JSON_MODE) {
    const report: JsonReport = {
      summary: {
        totalFiles,
        cleanFiles: totalClean,
        totalErrors,
        totalWarnings,
        fixed: totalFixed,
      },
      issues: allIssues.map((i) => ({
        file: i.file,
        category: i.category,
        severity: i.severity,
        message: i.message,
        issueType: i.issueType,
        fixed: i.fixed ?? false,
      })),
      issuesByType: issueTypeCounts,
      categories: CATEGORY_ORDER
        .filter((cat) => catStats[cat] && catStats[cat]!.files > 0)
        .map((cat) => ({
          name: cat,
          files: catStats[cat]!.files,
          errors: catStats[cat]!.errors,
          warnings: catStats[cat]!.warnings,
        })),
    };
    console.log(JSON.stringify(report, null, 2));
    process.exit(totalErrors);
  }

  // ─── Fix mode output ────────────────────────────────────────────────────────

  if (FIX_MODE && totalFixed > 0) {
    console.log();
    console.log(paintBold(`=== Fixed ${totalFixed} issue(s) ===`, HEX.OK));
    console.log();

    const fixedIssues = allIssues.filter((i) => i.fixed);
    const fixedByFile = new Map<string, string[]>();
    for (const issue of fixedIssues) {
      if (!fixedByFile.has(issue.file)) fixedByFile.set(issue.file, []);
      fixedByFile.get(issue.file)!.push(issue.issueType);
    }

    const fixTableData = [...fixedByFile.entries()].map(([file, types]) => ({
      File: file.replace(/^\.\//, ""),
      Fixed: types.join(", "),
    }));

    console.log(Bun.inspect.table(fixTableData, { colors: useColor() }));
    console.log();
  }

  // ─── Print grouped results ──────────────────────────────────────────────────

  console.log();
  console.log(paintBold("=== Documentation Quality Report ===", HEX.HEADER));
  console.log();

  for (const cat of CATEGORY_ORDER) {
    const stats = catStats[cat];
    if (!stats || stats.files === 0) continue;

    const catIssues = allIssues.filter((i) => i.category === cat && !i.fixed);
    if (catIssues.length === 0) continue;

    const statusHex = stats.errors > 0 ? HEX.ERROR : stats.warnings > 0 ? HEX.WARN : HEX.OK;
    const statusIconStr = stats.errors > 0 ? "✗" : stats.warnings > 0 ? "⚠" : "✓";

    console.log(
      `${paint(statusIconStr, statusHex)} ${paintBold(`[${cat}]`, HEX.BOLD)} ${paint(`(${stats.files} files, ${stats.errors} errors, ${stats.warnings} warnings)`, HEX.DIM)}`
    );
    console.log();

    const byFile = new Map<string, Issue[]>();
    for (const issue of catIssues) {
      if (!byFile.has(issue.file)) byFile.set(issue.file, []);
      byFile.get(issue.file)!.push(issue);
    }

    for (const [file, issues] of byFile) {
      for (const issue of issues) {
        const label = paint(issue.severity.padEnd(5), severityPaint(issue.severity));
        console.log(`  ${label} ${paint(file, HEX.DIM)} ${issue.message}`);
      }
    }
    console.log();
  }

  // ─── Issues by Type table ───────────────────────────────────────────────────

  console.log(paintBold("=== Issues by Type ===", HEX.HEADER));
  console.log();

  const issueTypeData = ["frontmatter", "related", "tags", "category", "find"].map((key) => {
    const count = issueTypeCounts[key] ?? 0;
    const isError = key === "frontmatter" || key === "related";
    const status = count === 0 ? "✓ OK" : isError ? "✗ ERROR" : "⚠ WARN";
    return {
      "Issue Type": key,
      Count: count,
      Status: status,
    };
  });

  console.log(Bun.inspect.table(issueTypeData, { colors: useColor() }));
  console.log();

  // ─── Per-category summary table ─────────────────────────────────────────────

  console.log(paintBold("=== Per-Category Summary ===", HEX.HEADER));
  console.log();

  const catTableData = CATEGORY_ORDER.filter((cat) => catStats[cat] && catStats[cat]!.files > 0).map((cat) => {
    const s = catStats[cat]!;
    const status = s.errors > 0 ? "✗" : s.warnings > 0 ? "⚠" : "✓";
    return {
      Category: cat,
      Files: s.files,
      Errors: s.errors,
      Warnings: s.warnings,
      Status: status,
    };
  });

  console.log(Bun.inspect.table(catTableData, { colors: useColor() }));
  console.log();

  // ─── Overall summary table ──────────────────────────────────────────────────

  console.log(paintBold("=== Summary ===", HEX.HEADER));
  console.log();

  const summaryData = [
    { Metric: "Total files scanned", Value: totalFiles },
    { Metric: "Clean files", Value: totalClean },
    { Metric: "Total errors", Value: totalErrors },
    { Metric: "Total warnings", Value: totalWarnings },
    ...(totalFixed > 0 ? [{ Metric: "Auto-fixed", Value: totalFixed }] : []),
  ];

  console.log(Bun.inspect.table(summaryData, { colors: useColor() }));
  console.log();

  // ─── Files needing attention table ──────────────────────────────────────────

  const filesWithErrors = allIssues
    .filter((i) => i.severity === "ERROR" && !i.fixed)
    .reduce((acc, i) => {
      if (!acc[i.file]) acc[i.file] = { file: i.file, category: i.category, errors: 0, warnings: 0 };
      acc[i.file]!.errors++;
      return acc;
    }, {} as Record<string, { file: string; category: string; errors: number; warnings: number }>);

  for (const i of allIssues.filter((i) => i.severity === "WARN" && !i.fixed)) {
    if (filesWithErrors[i.file]) filesWithErrors[i.file]!.warnings++;
  }

  if (Object.keys(filesWithErrors).length > 0) {
    console.log(paintBold("=== Files Needing Attention ===", HEX.HEADER));
    console.log();

    const attentionData = Object.values(filesWithErrors)
      .sort((a, b) => b.errors - a.errors || b.warnings - a.warnings)
      .slice(0, 20)
      .map((f) => ({
        File: f.file.replace(/^\.\//, ""),
        Category: f.category,
        Errors: f.errors,
        Warnings: f.warnings,
      }));

    console.log(Bun.inspect.table(attentionData, { colors: useColor() }));

    const remaining = Object.keys(filesWithErrors).length - 20;
    if (remaining > 0) {
      console.log(paint(`  ... and ${remaining} more`, HEX.DIM));
    }
    console.log();
  }

  // ─── Final verdict ──────────────────────────────────────────────────────────

  if (totalErrors === 0) {
    console.log(paintBold("✓ All docs pass quality checks", HEX.OK));
  } else {
    console.log(paintBold(`✗ ${totalErrors} error(s) found — see above`, HEX.ERROR));
  }

  process.exit(totalErrors);
}

main();
