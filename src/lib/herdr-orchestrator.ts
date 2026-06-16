import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TOML } from "bun";
import { discoverHerdrProjectConfig } from "./herdr-project-config.ts";
import { syncAgentsTabContext } from "./herdr-project-context.ts";
import { findWorkspaceForProject } from "./herdr-project-runner.ts";
import { herdrCliJson, herdrCliRun } from "./herdr-project-cli.ts";
import { escalateFinishWorkToReviewer, type FinishWorkReport } from "./finish-work-herdr.ts";
import {
  resolveOrchestratorConfig,
  type HerdrOrchestratorConfig,
} from "./herdr-orchestrator-config.ts";

export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

export interface AgentSnapshot {
  paneId: string;
  agent: string;
  status: AgentStatus;
  workspaceId: string;
  tabId?: string;
}

export interface OrchestratorState {
  schemaVersion: 1;
  updatedAt: string;
  workspaceId: string;
  agents: Record<string, { status: AgentStatus; paneId: string }>;
}

export interface OrchestratorAction {
  type: "context_sync" | "handoff" | "reviewer_escalation" | "skip";
  detail: string;
}

export interface OrchestratorReactResult {
  ok: boolean;
  workspaceId: string | null;
  actions: OrchestratorAction[];
  warnings: string[];
}

function statePath(projectRoot: string) {
  return join(projectRoot, ".kimi", "herdr-orchestrator-state.json");
}

function finishWorkReportPath(projectRoot: string) {
  return join(projectRoot, ".kimi", "finish-work-report.json");
}

function readState(projectRoot: string, workspaceId: string): OrchestratorState | null {
  const path = statePath(projectRoot);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as OrchestratorState;
    return parsed.workspaceId === workspaceId ? parsed : null;
  } catch {
    return null;
  }
}

function writeState(projectRoot: string, state: OrchestratorState) {
  const dir = join(projectRoot, ".kimi");
  mkdirSync(dir, { recursive: true });
  writeFileSync(statePath(projectRoot), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function listWorkspaceAgents(workspaceId: string, session = ""): AgentSnapshot[] {
  const listed = herdrCliJson(session, ["agent", "list"]);
  if (!listed.ok) return [];
  const rows = (listed.json?.result?.agents || []) as Array<{
    pane_id?: string;
    agent?: string;
    agent_status?: string;
    workspace_id?: string;
    tab_id?: string;
  }>;
  return rows
    .filter((row) => row.workspace_id === workspaceId && row.pane_id && row.agent)
    .map((row) => ({
      paneId: row.pane_id!,
      agent: row.agent!,
      status: (row.agent_status || "unknown") as AgentStatus,
      workspaceId,
      tabId: row.tab_id,
    }));
}

function resolveAgentTarget(agents: AgentSnapshot[], label: string | null): AgentSnapshot | null {
  if (!label) return null;
  const matches = agents.filter((row) => row.agent === label);
  if (matches.length === 1) return matches[0]!;
  return null;
}

function readAgentRecentText(paneId: string, session = "", lines = 12): string {
  const read = herdrCliJson(session, [
    "agent",
    "read",
    paneId,
    "--source",
    "recent",
    "--lines",
    String(lines),
    "--format",
    "text",
  ]);
  const text = (read.json?.result as { read?: { text?: string } } | undefined)?.read?.text ?? "";
  return text.trim();
}

function sendAgentText(session: string, target: string, text: string) {
  return herdrCliRun(session, ["agent", "send", target, text], 30_000);
}

function buildHandoffMessage(fromAgent: string, recentText: string): string {
  const excerpt = recentText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-8)
    .join("\n");
  return [
    `[orchestrator handoff from ${fromAgent}]`,
    excerpt || "(no recent output captured)",
    "",
    "Pick up from here or ask the primary for clarification.",
  ].join("\n");
}

function loadFinishWorkReport(projectRoot: string): FinishWorkReport | null {
  const path = finishWorkReportPath(projectRoot);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as FinishWorkReport;
  } catch {
    return null;
  }
}

function loadHerdrDoc(configPath: string | null): Record<string, unknown> | null {
  if (!configPath) return null;
  try {
    return TOML.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function reactHerdrOrchestrator(
  projectRoot: string,
  options: { session?: string; forceContext?: boolean; forceHandoff?: boolean } = {}
): Promise<OrchestratorReactResult> {
  const warnings: string[] = [];
  const actions: OrchestratorAction[] = [];

  const config = discoverHerdrProjectConfig(projectRoot);
  if (!config?.enabled) {
    return { ok: false, workspaceId: null, actions, warnings: ["no enabled [herdr] profile"] };
  }

  const fullConfig = { ...config, projectPath: projectRoot };
  const doc = loadHerdrDoc(config.sourcePath);
  const orchestrator = resolveOrchestratorConfig(fullConfig, doc);
  if (!orchestrator.enabled) {
    return {
      ok: true,
      workspaceId: null,
      actions: [{ type: "skip", detail: "orchestrator disabled" }],
      warnings,
    };
  }

  const match = findWorkspaceForProject(fullConfig);
  if (!match.workspaceId) {
    return {
      ok: false,
      workspaceId: null,
      actions,
      warnings: [`workspace not open (${match.reason})`],
    };
  }

  const workspaceId = match.workspaceId;
  const session = config.session || options.session || "";
  const agents = listWorkspaceAgents(workspaceId, session);
  const previous = readState(projectRoot, workspaceId);

  let contextSynced = false;
  let handoffSent = false;

  for (const agent of agents) {
    const prior = previous?.agents[agent.agent];
    const becameIdle =
      prior?.status === "working" && (agent.status === "idle" || agent.status === "done");

    if (orchestrator.contextOnIdle && (becameIdle || options.forceContext)) {
      const panes = fullConfig.agentsTab?.panes?.filter(
        (pane) => pane.agent === agent.agent && pane.context?.trim()
      );
      if (panes?.length && !contextSynced) {
        const sync = syncAgentsTabContext(fullConfig, panes, workspaceId);
        if (sync.delivered.length) {
          actions.push({
            type: "context_sync",
            detail: `delivered to ${sync.delivered.map((row) => row.agent).join(", ")}`,
          });
          contextSynced = true;
        }
        warnings.push(...sync.warnings);
      }
    }

    const fromLabel = orchestrator.handoffFrom;
    if (
      fromLabel &&
      agent.agent === fromLabel &&
      (becameIdle || options.forceHandoff) &&
      !handoffSent
    ) {
      const target = resolveAgentTarget(agents, orchestrator.handoffTo);
      if (target?.paneId) {
        const recent = readAgentRecentText(agent.paneId, session);
        const message = buildHandoffMessage(fromLabel, recent);
        const sent = sendAgentText(session, target.paneId, message);
        if (sent.ok) {
          actions.push({
            type: "handoff",
            detail: `${fromLabel} → ${target.agent} (${target.paneId})`,
          });
          handoffSent = true;
        } else {
          warnings.push(`handoff send failed: ${sent.output}`);
        }
      }
    }
  }

  const finishReport = loadFinishWorkReport(projectRoot);
  if (finishReport && finishReport.outcome === "escalated" && !finishReport.herdr?.escalated) {
    const escalated = await escalateFinishWorkToReviewer(projectRoot, finishReport);
    if (escalated.herdr?.escalated) {
      actions.push({
        type: "reviewer_escalation",
        detail: `reviewer pane ${escalated.herdr.reviewerPaneId}`,
      });
    } else if (escalated.herdr?.error) {
      warnings.push(escalated.herdr.error);
    } else if (escalated.herdr?.skipped) {
      actions.push({ type: "skip", detail: escalated.herdr.reason || "reviewer skipped" });
    }
  }

  const nextState: OrchestratorState = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    workspaceId,
    agents: Object.fromEntries(
      agents.map((row) => [row.agent, { status: row.status, paneId: row.paneId }])
    ),
  };
  writeState(projectRoot, nextState);

  return { ok: warnings.length === 0, workspaceId, actions, warnings };
}

export function orchestratorStatus(projectRoot: string): {
  config: HerdrOrchestratorConfig;
  agents: AgentSnapshot[];
  state: OrchestratorState | null;
} | null {
  const config = discoverHerdrProjectConfig(projectRoot);
  if (!config) return null;
  const fullConfig = { ...config, projectPath: projectRoot };
  const doc = loadHerdrDoc(config.sourcePath);
  const orchestrator = resolveOrchestratorConfig(fullConfig, doc);
  const match = findWorkspaceForProject(fullConfig);
  const agents = match.workspaceId ? listWorkspaceAgents(match.workspaceId, config.session) : [];
  const state = match.workspaceId ? readState(projectRoot, match.workspaceId) : null;
  return { config: orchestrator, agents, state };
}
