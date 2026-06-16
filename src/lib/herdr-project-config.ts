import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TOML } from "bun";

export const HERDR_PROJECT_CONFIG_NAMES = [
  ".dx/herdr.toml",
  "dx.config.toml",
  ".dx/config.toml",
  ".config/dx.toml",
] as const;

export type HerdrShellSplit = "right" | "down";

export interface HerdrProjectTab {
  label?: string;
  command?: string;
}

export interface HerdrProjectConfig {
  schemaVersion: number;
  enabled: boolean;
  workspaceLabel: string | null;
  primaryAgent: string | null;
  secondaryAgents: string[];
  shellPane: boolean;
  shellSplit: HerdrShellSplit;
  bootstrap: string[];
  session: string;
  tabs: HerdrProjectTab[];
  sourcePath: string | null;
  projectPath?: string;
}

function readToml(path: string): Record<string, unknown> {
  return TOML.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

export function isProjectOnlyHerdrProfilePath(sourceName: string): boolean {
  return sourceName === ".dx/herdr.toml" || sourceName.endsWith("/.dx/herdr.toml");
}

export function extractHerdrProjectSection(
  doc: Record<string, unknown> | null | undefined,
  sourceName = ""
): Omit<HerdrProjectConfig, "sourcePath" | "projectPath"> | null {
  if (!doc || typeof doc !== "object") return null;

  let section: Record<string, unknown> | undefined =
    doc.herdr && typeof doc.herdr === "object" ? (doc.herdr as Record<string, unknown>) : undefined;

  if (
    !section &&
    isProjectOnlyHerdrProfilePath(sourceName) &&
    doc.enabled !== false &&
    (doc.workspaceLabel != null ||
      doc.primaryAgent != null ||
      doc.shellPane != null ||
      Array.isArray(doc.bootstrap))
  ) {
    section = doc;
  }

  if (!section || typeof section !== "object") return null;

  const secondaryAgents = Array.isArray(section.secondaryAgents)
    ? section.secondaryAgents.filter((item): item is string => typeof item === "string")
    : [];

  const bootstrap = Array.isArray(section.bootstrap)
    ? section.bootstrap.filter((item): item is string => typeof item === "string")
    : [];

  const tabs = Array.isArray(section.tabs)
    ? section.tabs.filter(
        (item): item is HerdrProjectTab => item != null && typeof item === "object"
      )
    : [];

  return {
    schemaVersion:
      typeof section.schemaVersion === "number"
        ? section.schemaVersion
        : typeof doc.schemaVersion === "number"
          ? doc.schemaVersion
          : 1,
    enabled: section.enabled !== false,
    workspaceLabel:
      typeof section.workspaceLabel === "string"
        ? section.workspaceLabel
        : typeof doc.name === "string"
          ? doc.name
          : null,
    primaryAgent: typeof section.primaryAgent === "string" ? section.primaryAgent : null,
    secondaryAgents,
    shellPane: section.shellPane !== false,
    shellSplit: section.shellSplit === "down" ? "down" : "right",
    bootstrap,
    session: typeof section.session === "string" ? section.session : "",
    tabs,
  };
}

export function discoverHerdrProjectConfig(projectPath: string): HerdrProjectConfig | null {
  for (const name of HERDR_PROJECT_CONFIG_NAMES) {
    const candidate = join(projectPath, name);
    if (!existsSync(candidate)) continue;
    const doc = readToml(candidate);
    const section = extractHerdrProjectSection(doc, name);
    if (!section || !section.enabled) continue;
    return {
      ...section,
      sourcePath: candidate,
      projectPath,
    };
  }
  return null;
}
