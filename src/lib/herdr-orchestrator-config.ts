import type { HerdrProjectConfig } from "./herdr-project-config.ts";

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

  return {
    enabled: nested.enabled !== false,
    contextOnIdle: nested.contextOnIdle !== false,
    handoffFrom: typeof nested.handoffFrom === "string" ? nested.handoffFrom : null,
    handoffTo: typeof nested.handoffTo === "string" ? nested.handoffTo : null,
    reviewerTab: typeof nested.reviewerTab === "string" ? nested.reviewerTab : "reviewer",
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
  };
}
