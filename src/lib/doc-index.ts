/**
 * doc-index.ts — Programmatic INDEX.md generation from markdown frontmatter.
 *
 * Scans all .md files (excluding node_modules, .git, build dirs), parses
 * frontmatter for title/tags/category/status, and generates a categorized
 * index table matching the format defined in docs/style-guide.md.
 */

import { Glob } from "bun";
import { join } from "path";

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

const CATEGORY_LABELS: Record<string, string> = {
  root: "Root Documentation",
  core: "Core Documentation",
  adr: "ADRs (Architecture Decision Records)",
  references: "References",
  plans: "Plans (Archived)",
  canvases: "Canvases",
  "sub-tables": "Sub-tables",
  examples: "Examples",
  skills: "Skills",
  templates: "Templates",
  schemas: "Schemas",
  test: "Test",
  src: "Source",
  other: "Other",
};

export interface DocEntry {
  path: string;
  title: string;
  tags: string[];
  category: string;
  status: string;
  description: string;
}

export interface IndexReport {
  totalFiles: number;
  indexed: number;
  skipped: number;
  categories: Array<{ name: string; label: string; count: number }>;
  output: string;
}

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

function parseFrontmatter(text: string): {
  title?: string;
  tags?: string[];
  category?: string;
  status?: string;
} {
  const fmMatch = text.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return {};

  const fm = fmMatch[1]!;
  const result: { title?: string; tags?: string[]; category?: string; status?: string } = {};

  const titleMatch = fm.match(/^title:\s*"?(.+?)"?\s*$/m);
  if (titleMatch) result.title = titleMatch[1]!.trim();

  const tagsMatch = fm.match(/^tags:\s*\[(.+?)\]\s*$/m);
  if (tagsMatch) {
    result.tags = tagsMatch[1]!.split(",").map((t) => t.trim().replace(/["']/g, ""));
  }

  const catMatch = fm.match(/^category:\s*(.+?)\s*$/m);
  if (catMatch) result.category = catMatch[1]!.trim();

  const statusMatch = fm.match(/^status:\s*(.+?)\s*$/m);
  if (statusMatch) result.status = statusMatch[1]!.trim();

  return result;
}

function extractDescription(text: string): string {
  const body = text.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const h1Match = body.match(/^#\s+(.+)$/m);
  if (h1Match) return h1Match[1]!.trim();

  const firstPara = body
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && !l.startsWith("|") && !l.startsWith("```"))
    .find((l) => l.trim().length > 10);
  return firstPara?.trim().slice(0, 100) ?? "";
}

function inferTitleFromPath(filePath: string): string {
  const name = filePath.replace(/^\.\//, "").replace(/\.md$/, "");
  const base = name.split("/").pop() ?? name;
  return base
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/^ADR/, "ADR");
}

export async function scanDocs(rootDir: string): Promise<DocEntry[]> {
  const glob = new Bun.Glob("**/*.md");
  const entries: DocEntry[] = [];

  for await (const path of glob.scan(rootDir)) {
    if (shouldSkip(path)) continue;

    const fullPath = join(rootDir, path);
    const text = await Bun.file(fullPath).text();
    const fm = parseFrontmatter(text);
    const category = getCategory(path);

    entries.push({
      path: path.replace(/^\.\//, ""),
      title: fm.title ?? inferTitleFromPath(path),
      tags: fm.tags ?? [],
      category,
      status: fm.status ?? "draft",
      description: extractDescription(text),
    });
  }

  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

export function generateIndex(entries: DocEntry[]): string {
  const lines: string[] = [];

  lines.push("---");
  lines.push('title: "Documentation Index"');
  lines.push("tags: [index, docs, navigation]");
  lines.push("category: meta");
  lines.push("status: stable");
  lines.push("priority: high");
  lines.push('last-reviewed: "' + new Date().toISOString().slice(0, 10) + '"');
  lines.push("---");
  lines.push("");
  lines.push("# Documentation Index");
  lines.push("");
  lines.push("## Description");
  lines.push("");
  lines.push(
    "Single source of truth for all documentation files in kimi-toolchain. Every doc should be linked from here. Use `rg` with the patterns described in [docs/style-guide.md](docs/style-guide.md) for fast navigation."
  );
  lines.push("");

  for (const cat of CATEGORY_ORDER) {
    const catEntries = entries.filter((e) => e.category === cat);
    if (catEntries.length === 0) continue;

    const label = CATEGORY_LABELS[cat] ?? cat;
    lines.push(`## ${label}`);
    lines.push("");
    lines.push("| File | Description | Tags |");
    lines.push("|------|-------------|------|");

    for (const entry of catEntries) {
      const link = `[${entry.path}](${entry.path})`;
      const desc = entry.description || entry.title;
      const tags = entry.tags.length > 0 ? entry.tags.map((t) => `\`${t}\``).join(", ") : "";
      lines.push(`| ${link} | ${desc} | ${tags} |`);
    }

    lines.push("");
  }

  lines.push("## Quick Navigation");
  lines.push("");
  lines.push("```bash");
  lines.push("# Find all docs by tag");
  lines.push("rgdoc 'tags: security'");
  lines.push("");
  lines.push("# Find all description sections");
  lines.push("rgdoc '^## Description'");
  lines.push("");
  lines.push("# Find all #find: anchors");
  lines.push("rgdoc '#find:'");
  lines.push("");
  lines.push("# Find all #scan: markers");
  lines.push("rgdoc '#scan:'");
  lines.push("");
  lines.push("# Find all cross-references");
  lines.push("rgdoc '\\[.*\\]\\(.*\\.md\\)'");
  lines.push("");
  lines.push("# Find all stable docs");
  lines.push("rgdoc 'status: stable'");
  lines.push("");
  lines.push("# Find all high-priority docs");
  lines.push("rgdoc 'priority: high'");
  lines.push("");
  lines.push("# Run quality checks");
  lines.push("bun scripts/check-docs.ts           # check all docs");
  lines.push("bun scripts/check-docs.ts --fix     # auto-fix missing frontmatter/Related/tags");
  lines.push("bun scripts/check-docs.ts --json    # machine-readable JSON for CI");
  lines.push("```");
  lines.push("");
  lines.push("## Related");
  lines.push("");
  lines.push("- [docs/style-guide.md](docs/style-guide.md) — Documentation style guide and conventions");
  lines.push("- [MACROS.md](MACROS.md) — Bun macros API reference");
  lines.push("- [scripts/check-docs.ts](scripts/check-docs.ts) — Documentation quality check script");
  lines.push("");

  return lines.join("\n");
}

export async function buildIndex(rootDir: string): Promise<IndexReport> {
  const entries = await scanDocs(rootDir);
  const output = generateIndex(entries);

  const categories = CATEGORY_ORDER.filter((cat) =>
    entries.some((e) => e.category === cat)
  ).map((cat) => ({
    name: cat,
    label: CATEGORY_LABELS[cat] ?? cat,
    count: entries.filter((e) => e.category === cat).length,
  }));

  return {
    totalFiles: entries.length,
    indexed: entries.length,
    skipped: 0,
    categories,
    output,
  };
}
