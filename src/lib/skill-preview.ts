/**
 * skill-preview.ts — Resolve SKILL.md targets and render terminal previews.
 */

import { join } from "path";
import { pathExists } from "./bun-io.ts";
import { renderMarkdownAnsi } from "./bun-markdown.ts";
import { homeDir } from "./paths.ts";
import { readFrontmatterScalar } from "./skill-table.ts";

export interface PreviewCliArgs {
  skillName?: string;
  all: boolean;
  json: boolean;
  noColor: boolean;
  columns?: number;
}

export interface SkillPreviewTarget {
  name: string;
  path: string;
  lines: number;
  text: string;
}

export interface SkillPreviewJsonSkill {
  name: string;
  path: string;
  lines: number;
  preview: string;
  ansi?: string;
}

export interface ResolveSkillPreviewsOptions {
  repoRoot: string;
  skillName?: string;
  includeAgents?: boolean;
  home?: string;
}

/** Parse `kimi-context-gen preview` argv (after the `preview` token). */
export function parsePreviewCliArgs(args: string[]): PreviewCliArgs | { error: string } {
  let skillName: string | undefined;
  let all = false;
  let json = false;
  let noColor = false;
  let columns: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--all") {
      all = true;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--no-color") {
      noColor = true;
      continue;
    }
    if (arg === "--columns") {
      const raw = args[++i];
      if (!raw) return { error: "--columns requires a number" };
      const value = Number.parseInt(raw, 10);
      if (!Number.isFinite(value) || value < 0) {
        return { error: "--columns must be a non-negative integer" };
      }
      columns = value;
      continue;
    }
    if (!arg) continue;
    if (arg.startsWith("--")) {
      return { error: `unknown flag: ${arg}` };
    }
    if (skillName) return { error: "only one skill name is allowed" };
    skillName = arg;
  }

  return { skillName, all, json, noColor, columns };
}

function skillNameFromText(path: string, text: string): string {
  const head = text.slice(0, 800);
  const fromFrontmatter = readFrontmatterScalar(head, "name");
  if (fromFrontmatter !== "—") return fromFrontmatter;
  const base = path.split("/").at(-2);
  return base ?? path;
}

function matchesSkillFilter(name: string, path: string, filter: string): boolean {
  const normalized = filter.trim().toLowerCase();
  if (!normalized) return true;
  const dir = path.split("/").at(-2)?.toLowerCase();
  return name.toLowerCase() === normalized || dir === normalized;
}

async function scanSkillTargets(root: string): Promise<SkillPreviewTarget[]> {
  if (!pathExists(root)) return [];

  const targets: SkillPreviewTarget[] = [];
  const skillsGlob = new Bun.Glob("*/SKILL.md");

  for await (const rel of skillsGlob.scan({ cwd: root, onlyFiles: true })) {
    const path = join(root, rel);
    const text = await Bun.file(path).text();
    targets.push({
      name: skillNameFromText(path, text),
      path,
      lines: text.split("\n").length,
      text,
    });
  }

  return targets;
}

/** Resolve repo (and optional ~/.agents/skills) SKILL.md files for preview. */
export async function resolveSkillPreviews(
  options: ResolveSkillPreviewsOptions
): Promise<SkillPreviewTarget[]> {
  const repoSkillsDir = join(options.repoRoot, "skills");
  const targets: SkillPreviewTarget[] = [];

  targets.push(...(await scanSkillTargets(repoSkillsDir)));

  if (options.includeAgents) {
    const agentsRoot = join(options.home || homeDir(), ".agents", "skills");
    targets.push(...(await scanSkillTargets(agentsRoot)));
  }

  const filtered = options.skillName
    ? targets.filter((target) => matchesSkillFilter(target.name, target.path, options.skillName!))
    : targets;

  filtered.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
  return filtered;
}

export interface BuildSkillPreviewJsonOptions {
  colors?: boolean;
  columns?: number;
  includeAnsi?: boolean;
}

/** Build JSON rows for preview output. */
export function buildSkillPreviewJsonSkills(
  targets: SkillPreviewTarget[],
  options: BuildSkillPreviewJsonOptions = {}
): SkillPreviewJsonSkill[] {
  const colors = options.colors ?? true;
  const includeAnsi = options.includeAnsi ?? colors;

  return targets.map((target) => {
    const preview = renderMarkdownAnsi(target.text, {
      colors: false,
      columns: options.columns,
    });
    const row: SkillPreviewJsonSkill = {
      name: target.name,
      path: target.path,
      lines: target.lines,
      preview,
    };
    if (includeAnsi) {
      row.ansi = renderMarkdownAnsi(target.text, {
        colors,
        columns: options.columns,
      });
    }
    return row;
  });
}

/** Human-readable ANSI preview blocks separated for stdout. */
export function formatSkillPreviewHuman(
  targets: SkillPreviewTarget[],
  options: { colors?: boolean; columns?: number } = {}
): string {
  const colors = options.colors ?? true;
  const blocks = targets.map((target) => {
    const header = `── ${target.name} (${target.path}, ${target.lines} lines) ──`;
    const body = renderMarkdownAnsi(target.text, {
      colors,
      columns: options.columns,
    });
    return `${header}\n${body}`;
  });
  return blocks.join("\n\n");
}
