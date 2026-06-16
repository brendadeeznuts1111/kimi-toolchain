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

export type HerdrPaneRole = "primary" | "secondary" | "shell";

export interface HerdrAgentsTabPane {
  role: HerdrPaneRole;
  agent?: string;
  split?: HerdrShellSplit;
  ratio?: number;
  label?: string;
  command?: string;
  /** Shell command whose stdout is sent to the agent after start/reconcile. */
  context?: string;
  env?: Record<string, string>;
}

export interface HerdrAgentsTab {
  label: string;
  panes: HerdrAgentsTabPane[];
}

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
  agentsTab: HerdrAgentsTab | null;
  tabs: HerdrProjectTab[];
  sourcePath: string | null;
  projectPath?: string;
}

function readToml(path: string): Record<string, unknown> {
  return TOML.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

const HERDR_PANE_ROLES = new Set<HerdrPaneRole>(["primary", "secondary", "shell"]);

function parseAgentsTabPane(value: unknown): HerdrAgentsTabPane | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const role = typeof row.role === "string" ? row.role : "";
  if (!HERDR_PANE_ROLES.has(role as HerdrPaneRole)) return null;

  const env =
    row.env && typeof row.env === "object"
      ? Object.fromEntries(
          Object.entries(row.env as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string"
          )
        )
      : undefined;

  return {
    role: role as HerdrPaneRole,
    agent: typeof row.agent === "string" ? row.agent : undefined,
    split: row.split === "down" ? "down" : row.split === "right" ? "right" : undefined,
    ratio: typeof row.ratio === "number" ? row.ratio : undefined,
    label: typeof row.label === "string" ? row.label : undefined,
    command: typeof row.command === "string" ? row.command : undefined,
    context: typeof row.context === "string" ? row.context : undefined,
    env,
  };
}

function parseAgentsTab(
  doc: Record<string, unknown>,
  section: Record<string, unknown>
): HerdrAgentsTab | null {
  const nested =
    section.agentsTab && typeof section.agentsTab === "object"
      ? (section.agentsTab as Record<string, unknown>)
      : doc.agentsTab && typeof doc.agentsTab === "object"
        ? (doc.agentsTab as Record<string, unknown>)
        : null;

  if (!nested) return null;

  const panes = Array.isArray(nested.panes)
    ? nested.panes
        .map(parseAgentsTabPane)
        .filter((pane): pane is HerdrAgentsTabPane => pane != null)
    : [];

  if (!panes.length) return null;

  return {
    label: typeof nested.label === "string" ? nested.label : "agents",
    panes,
  };
}

function syncLegacyFieldsFromAgentsTab(
  section: Record<string, unknown>,
  agentsTab: HerdrAgentsTab | null
): void {
  if (!agentsTab) return;

  const primary = agentsTab.panes.find((pane) => pane.role === "primary");
  const secondaries = agentsTab.panes
    .filter((pane) => pane.role === "secondary" && pane.agent)
    .map((pane) => pane.agent!);
  const shellPane = agentsTab.panes.some((pane) => pane.role === "shell");
  const shellSplit = agentsTab.panes.find((pane) => pane.role === "shell")?.split;

  if (section.primaryAgent == null && primary?.agent) {
    section.primaryAgent = primary.agent;
  }
  if (!Array.isArray(section.secondaryAgents) && secondaries.length) {
    section.secondaryAgents = secondaries;
  }
  if (section.shellPane == null) {
    section.shellPane = shellPane;
  }
  if (section.shellSplit == null && shellSplit) {
    section.shellSplit = shellSplit;
  }
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

  const agentsTab = parseAgentsTab(doc, section);
  syncLegacyFieldsFromAgentsTab(section, agentsTab);

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
    agentsTab,
    tabs,
  };
}

export interface DiscoverHerdrProjectOptions {
  /** When true, return profiles with enabled = false (default: skip them). */
  includeDisabled?: boolean;
}

export function discoverHerdrProjectConfig(
  projectPath: string,
  options: DiscoverHerdrProjectOptions = {}
): HerdrProjectConfig | null {
  for (const name of HERDR_PROJECT_CONFIG_NAMES) {
    const candidate = join(projectPath, name);
    if (!existsSync(candidate)) continue;
    const doc = readToml(candidate);
    const section = extractHerdrProjectSection(doc, name);
    if (!section) continue;
    if (!options.includeDisabled && !section.enabled) continue;
    return {
      ...section,
      sourcePath: candidate,
      projectPath,
    };
  }
  return null;
}
