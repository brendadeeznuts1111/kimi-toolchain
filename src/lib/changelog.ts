import { pathExists } from "./bun-io.ts";
import { join } from "path";
import type { Commit } from "./conventional-commits.ts";

export interface ChangelogSection {
  version: string;
  date: string;
  added: string[];
  changed: string[];
  fixed: string[];
  deprecated: string[];
  removed: string[];
  security: string[];
  breaking: string[];
}

const CONVENTIONAL_RE = /^(\w+)(?:\(([^)]+)\))?!?:\s*(.+)$/;

export function commitsToSection(commits: Commit[], version: string): ChangelogSection {
  const section: ChangelogSection = {
    version,
    date: new Date().toISOString().split("T")[0] ?? new Date().toISOString(),
    added: [],
    changed: [],
    fixed: [],
    deprecated: [],
    removed: [],
    security: [],
    breaking: [],
  };

  for (const c of commits) {
    const entry = c.scope
      ? `**${c.scope}:** ${c.subject.replace(CONVENTIONAL_RE, "$3")}`
      : c.subject.replace(CONVENTIONAL_RE, "$3");
    const hashLink = ` ([${c.hash.slice(0, 7)}])`;

    if (c.breaking) section.breaking.push(entry + hashLink);
    else if (c.type === "feat") section.added.push(entry + hashLink);
    else if (c.type === "fix") section.fixed.push(entry + hashLink);
    else if (c.type === "docs") section.changed.push(entry + hashLink);
    else if (c.type === "refactor") section.changed.push(entry + hashLink);
    else if (c.type === "perf") section.changed.push(entry + hashLink);
    else if (c.type === "test") section.changed.push(entry + hashLink);
    else if (c.type === "chore") section.changed.push(entry + hashLink);
    else if (c.type === "deps" || c.type === "dependency") section.security.push(entry + hashLink);
  }

  return section;
}

export function formatSection(section: ChangelogSection): string {
  const lines: string[] = [`## [${section.version}] - ${section.date}`, ""];

  const pushCategory = (title: string, items: string[]) => {
    if (items.length === 0) return;
    lines.push(`### ${title}`, "");
    for (const item of items) lines.push(`- ${item}`);
    lines.push("");
  };

  if (section.breaking.length > 0) {
    lines.push("### ⚠ BREAKING CHANGES", "");
    for (const item of section.breaking) lines.push(`- ${item}`);
    lines.push("");
  }

  pushCategory("Added", section.added);
  pushCategory("Changed", section.changed);
  pushCategory("Fixed", section.fixed);
  pushCategory("Deprecated", section.deprecated);
  pushCategory("Removed", section.removed);
  pushCategory("Security", section.security);

  return lines.join("\n");
}

export async function updateChangelog(projectDir: string, section: string, _version: string) {
  const changelogPath = join(projectDir, "CHANGELOG.md");

  let content =
    "# Changelog\n\nAll notable changes to this project will be documented in this file.\n\n";
  if (pathExists(changelogPath)) {
    content = await Bun.file(changelogPath).text();
  }

  const unreleasedMatch = content.match(/## \[Unreleased\]/);
  if (unreleasedMatch) {
    const insertAfter = content.indexOf("\n## [", content.indexOf("## [Unreleased]") + 1);
    if (insertAfter > 0) {
      content = content.slice(0, insertAfter) + "\n" + section + "\n" + content.slice(insertAfter);
    } else {
      content = content + "\n" + section;
    }
  } else {
    const firstH2 = content.search(/\n## \[/);
    if (firstH2 > 0) {
      content = content.slice(0, firstH2 + 1) + section + "\n" + content.slice(firstH2 + 1);
    } else {
      content = content + "\n" + section;
    }
  }

  await Bun.write(changelogPath, content);
}
