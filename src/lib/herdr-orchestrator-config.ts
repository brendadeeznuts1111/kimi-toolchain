import type { HerdrProjectConfig } from "./herdr-project-config.ts";

export const DEFAULT_ORCHESTRATOR_EVENT_ALLOWLIST = [
  "workspace.updated",
  "pane.agent_status_changed",
  "effect.gates.changed",
  "git.ref.changed",
] as const;

export interface HerdrOrchestratorEventsConfig {
  enabled: boolean;
  debounceMs: number;
  /** Null = default allowlist. Empty array = accept all known events. */
  allowlist: string[] | null;
  /** Poll .git/HEAD for commits while agents are running. */
  watchGit: boolean;
}

export interface HerdrOrchestratorConfig {
  enabled: boolean;
  /** Sync agentsTab context when an agent transitions working → idle. */
  contextOnIdle: boolean;
  /** Agent label to read for handoff summary (default: primary). */
  handoffFrom: string | null;
  /** Agent pane to receive handoff via agent send (default: first secondary). */
  handoffTo: string | null;
  /** Tab label for finish-work reviewer escalation. */
  reviewerTab: string;
  events: HerdrOrchestratorEventsConfig;
}

export function parseHerdrOrchestratorSection(
  section: Record<string, unknown> | undefined
): HerdrOrchestratorConfig | null {
  if (!section || typeof section !== "object") return null;
  const nested =
    section.orchestrator && typeof section.orchestrator === "object"
      ? (section.orchestrator as Record<string, unknown>)
      : null;
  if (!nested) return null;

  const eventsNested =
    nested.events && typeof nested.events === "object"
      ? (nested.events as Record<string, unknown>)
      : null;

  return {
    enabled: nested.enabled !== false,
    contextOnIdle: nested.contextOnIdle !== false,
    handoffFrom: typeof nested.handoffFrom === "string" ? nested.handoffFrom : null,
    handoffTo: typeof nested.handoffTo === "string" ? nested.handoffTo : null,
    reviewerTab: typeof nested.reviewerTab === "string" ? nested.reviewerTab : "reviewer",
    events: parseOrchestratorEventsSection(eventsNested),
  };
}

export function parseOrchestratorEventsSection(
  section: Record<string, unknown> | null
): HerdrOrchestratorEventsConfig {
  if (!section) {
    return {
      enabled: true,
      debounceMs: 2_000,
      allowlist: [...DEFAULT_ORCHESTRATOR_EVENT_ALLOWLIST],
      watchGit: true,
    };
  }

  let allowlist: string[] | null = [...DEFAULT_ORCHESTRATOR_EVENT_ALLOWLIST];
  if (Array.isArray(section.allowlist)) {
    const parsed = section.allowlist.filter((row): row is string => typeof row === "string");
    allowlist = parsed.length ? parsed : null;
  } else if (section.allowlist === null) {
    allowlist = null;
  }

  return {
    enabled: section.enabled !== false,
    debounceMs:
      typeof section.debounceMs === "number" && section.debounceMs >= 0
        ? section.debounceMs
        : 2_000,
    allowlist,
    watchGit: section.watchGit !== false,
  };
}

export function resolveOrchestratorConfig(
  config: HerdrProjectConfig,
  doc?: Record<string, unknown> | null
): HerdrOrchestratorConfig {
  const fromDoc =
    doc?.herdr && typeof doc.herdr === "object"
      ? parseHerdrOrchestratorSection(doc.herdr as Record<string, unknown>)
      : null;

  const handoffFrom =
    fromDoc?.handoffFrom ??
    config.primaryAgent ??
    config.agentsTab?.panes.find((p) => p.role === "primary")?.agent ??
    null;
  const handoffTo =
    fromDoc?.handoffTo ??
    config.secondaryAgents[0] ??
    config.agentsTab?.panes.find((p) => p.role === "secondary")?.agent ??
    null;

  return {
    enabled: fromDoc?.enabled ?? true,
    contextOnIdle: fromDoc?.contextOnIdle ?? true,
    handoffFrom,
    handoffTo,
    reviewerTab: fromDoc?.reviewerTab ?? "reviewer",
    events: fromDoc?.events ?? parseOrchestratorEventsSection(null),
  };
}
