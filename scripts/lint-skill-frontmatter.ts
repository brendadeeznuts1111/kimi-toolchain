#!/usr/bin/env bun
/**
 * lint-skill-frontmatter.ts — Validate skill YAML frontmatter for required keys,
 * valid enumerations, and cross-skill dependency consistency.
 *
 * Usage:
 *   bun run scripts/lint-skill-frontmatter.ts
 *   bun run scripts/lint-skill-frontmatter.ts --json
 */

import { join } from "path";
import { pathExists } from "../src/lib/bun-io.ts";

const REPO_ROOT = join(import.meta.dir, "..");
const SKILLS_DIR = join(REPO_ROOT, "skills");

const REQUIRED_KEYS = [
  "name",
  "description",
  "whenToUse",
  "layer",
  "trigger",
  "dependencies",
  "loaded_by",
  "role",
  "token_estimate",
  "run_as",
] as const;

/** Optional keys after required block — stable order for lint + authoring. */
const OPTIONAL_KEY_ORDER = ["allowed_tools", "model", "effort", "metadata"] as const;

const FRONTMATTER_KEY_ORDER = [...REQUIRED_KEYS, ...OPTIONAL_KEY_ORDER];

const VALID_LAYERS = new Set(["L1", "L2", "L3", "L1+L2", "L1+L2+L3"]);

const VALID_LOADED_BY = new Set(["System / On-demand", "HERDR_ENV gate"]);

const VALID_RUN_AS = new Set(["inline", "subagent"]);

interface SkillFrontmatterError {
  skill: string;
  message: string;
}

/** Get all skill names from skills/ directories. */
async function listSkillDirs(): Promise<string[]> {
  const entries: string[] = [];
  if (!pathExists(SKILLS_DIR)) return entries;
  for await (const entry of Array.from(
    new Bun.Glob("*").scanSync({ cwd: SKILLS_DIR, onlyFiles: false })
  )) {
    if (entry !== "." && !entry.startsWith(".")) {
      const skillFile = join(SKILLS_DIR, entry, "SKILL.md");
      if (pathExists(skillFile)) entries.push(entry);
    }
  }
  return entries;
}

function parseLines(text: string): string[] {
  return text.split("\n");
}

/** Parse YAML frontmatter block between --- markers. */
function parseFrontmatter(text: string): Map<string, string | null> | null {
  const lines = parseLines(text);
  if (lines.length === 0 || lines[0] !== "---") return null;

  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line?.trimRight() === "---") {
      endIndex = i;
      break;
    }
  }
  if (endIndex === -1) return null;

  const entries = new Map<string, string | null>();
  let currentKey: string | null = null;
  let isMultiline = false;
  let multilineValue: string[] = [];

  for (let i = 1; i < endIndex; i++) {
    const line = lines[i];
    if (line === undefined) continue;

    // Inside multiline block scalar
    if (isMultiline) {
      if (line.match(/^\s{2}/)) {
        multilineValue.push(line.trimStart());
        continue;
      }
      // End of multiline
      if (currentKey) entries.set(currentKey, multilineValue.join("\n").trim());
      isMultiline = false;
      multilineValue = [];
    }

    // Key: value (scalar)
    const kvMatch = line.match(/^(\w[\w_]*):\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      const rawValue = kvMatch[2];
      if (!key || rawValue === undefined) continue;
      const value = rawValue.trim();

      if (value === "|") {
        // Block scalar indicator
        currentKey = key;
        isMultiline = true;
        multilineValue = [];
        continue;
      }

      if (value === "") {
        // Empty value (e.g. "dependencies:" followed by list items or truly empty)
        // Look ahead for list items
        const nextLine = i + 1 < endIndex ? lines[i + 1] : "";
        if (nextLine && nextLine.match(/^\s{2}-/)) {
          // Has list items — treat as present
          entries.set(key, "__PRESENT__");
        } else {
          entries.set(key, null);
        }
        continue;
      }

      entries.set(key, value);
      continue;
    }

    // Line with no key — could be a list item if previous key had empty value
    // But we already handle that in the lookahead above
  }

  if (isMultiline && currentKey) {
    entries.set(currentKey, multilineValue.join("\n").trim());
  }

  return entries;
}

function checkFrontmatterKeyOrder(
  skillName: string,
  frontmatter: Map<string, string | null>
): SkillFrontmatterError[] {
  const errors: SkillFrontmatterError[] = [];
  const present = [...frontmatter.keys()];
  const orderIndex = new Map(FRONTMATTER_KEY_ORDER.map((key, index) => [key, index]));

  let lastIndex = -1;
  for (const key of present) {
    const index = orderIndex.get(key as (typeof FRONTMATTER_KEY_ORDER)[number]);
    if (index === undefined) continue;
    if (index < lastIndex) {
      errors.push({
        skill: skillName,
        message: `frontmatter key "${key}" is out of canonical order — see templates/scaffold/skill-template.md`,
      });
      break;
    }
    lastIndex = index;
  }

  return errors;
}

function checkFrontmatter(
  skillName: string,
  frontmatter: Map<string, string | null>
): SkillFrontmatterError[] {
  const errors: SkillFrontmatterError[] = [];

  for (const key of REQUIRED_KEYS) {
    if (!frontmatter.has(key)) {
      errors.push({ skill: skillName, message: `missing required key: ${key}` });
    }
  }

  const layer = frontmatter.get("layer");
  if (layer && !VALID_LAYERS.has(layer)) {
    errors.push({
      skill: skillName,
      message: `invalid layer "${layer}" — must be one of: ${[...VALID_LAYERS].join(", ")}`,
    });
  }

  const loadedBy = frontmatter.get("loaded_by");
  if (loadedBy && !VALID_LOADED_BY.has(loadedBy)) {
    errors.push({
      skill: skillName,
      message: `invalid loaded_by "${loadedBy}" — must be one of: ${[...VALID_LOADED_BY].join(", ")}`,
    });
  }

  const runAs = frontmatter.get("run_as");
  if (runAs && !VALID_RUN_AS.has(runAs)) {
    errors.push({
      skill: skillName,
      message: `invalid run_as "${runAs}" — must be one of: ${[...VALID_RUN_AS].join(", ")}`,
    });
  }

  return errors;
}

function checkDependencies(
  skillName: string,
  allSkillNames: Set<string>,
  skillText: string
): SkillFrontmatterError[] {
  const errors: SkillFrontmatterError[] = [];

  // Parse dependency list from YAML: look for "dependencies:" followed by list items
  const lines = parseLines(skillText);
  let inDeps = false;
  const deps: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    if (line.trimRight() === "---") {
      if (deps.length > 0) break; // reached end of frontmatter
      continue;
    }
    if (inDeps) {
      const match = line.match(/^\s{2}-\s+(\S[\w-]*)/);
      const dependency = match?.[1];
      if (dependency) {
        deps.push(dependency);
        continue;
      }
      // No more list items — exit
      break;
    }
    if (line.startsWith("dependencies:")) {
      inDeps = true;
    }
  }

  for (const dep of deps) {
    if (!allSkillNames.has(dep)) {
      errors.push({
        skill: skillName,
        message: `dependency "${dep}" does not match any known skill`,
      });
    }
  }

  // Check companionSkills in metadata (parsed from lines; frontmatter map is shallow)
  const companionDeps = parseCompanionDeps(lines);
  for (const dep of companionDeps) {
    if (!allSkillNames.has(dep)) {
      errors.push({
        skill: skillName,
        message: `companion skill "${dep}" does not match any known skill`,
      });
    }
  }

  return errors;
}

function parseCompanionDeps(lines: string[]): string[] {
  const deps: string[] = [];
  let inMetadata = false;
  let inCompanionSkills = false;

  for (const line of lines) {
    if (line.trimRight() === "---") {
      if (inCompanionSkills) break;
      continue;
    }
    if (!inMetadata && line.startsWith("metadata:")) {
      inMetadata = true;
      continue;
    }
    if (inMetadata && line.match(/^\s{2}companionSkills?:\s*$/)) {
      inCompanionSkills = true;
      continue;
    }
    if (inCompanionSkills) {
      const match = line.match(/^\s{4}-\s+(\S[\w-]*)/);
      if (match) {
        deps.push(match[1]!);
      } else if (line.match(/^\s{2}\w/)) {
        // Next metadata key
        break;
      }
    }
  }

  return deps;
}

async function main(): Promise<number> {
  const json = Bun.argv.includes("--json");
  const skillDirs = await listSkillDirs();
  const allSkillNames = new Set(skillDirs);

  let allErrors: SkillFrontmatterError[] = [];
  let skillsChecked = 0;

  for (const dir of skillDirs) {
    const skillFile = join(SKILLS_DIR, dir, "SKILL.md");
    if (!pathExists(skillFile)) continue;

    const text = await Bun.file(skillFile).text();
    const fm = parseFrontmatter(text);
    if (!fm) {
      allErrors.push({ skill: dir, message: "no valid YAML frontmatter found" });
      continue;
    }

    const errors = [
      ...checkFrontmatter(dir, fm),
      ...checkFrontmatterKeyOrder(dir, fm),
      ...checkDependencies(dir, allSkillNames, text),
    ];

    if (errors.length > 0) {
      allErrors = allErrors.concat(errors);
    }
    skillsChecked++;
  }

  if (json) {
    console.log(
      JSON.stringify({
        schemaVersion: 1,
        tool: "lint-skill-frontmatter",
        ok: allErrors.length === 0,
        skillsChecked,
        errors: allErrors,
      })
    );
  } else if (allErrors.length > 0) {
    console.error("\u2717 Skill frontmatter errors:\n");
    for (const err of allErrors) {
      console.error(`  ${err.skill}: ${err.message}`);
    }
    console.error(`\n${allErrors.length} error(s) in ${skillsChecked} skill(s)`);
  } else {
    console.log("lint:skill-frontmatter OK");
  }

  return allErrors.length === 0 ? 0 : 1;
}

const code = await main();
process.exit(code);
