import { makeDir, pathExists, readText, writeText } from "./bun-io.ts";

import { governedSpawn } from "./governor-spawn.ts";
import { join } from "path";
import { discoverHerdrProjectConfig } from "./herdr-project-config.ts";
import { syncAgentsTabContext } from "./herdr-project-context.ts";
import { findWorkspaceForProject } from "./herdr-project-runner.ts";
import { herdrCliJson, herdrCliRun } from "./herdr-project-cli.ts";
import {
  escalateFinishWorkToReviewer,
  normalizeFinishWorkReport,
  type FinishWorkReport,
} from "./finish-work-herdr.ts";
import { finishWorkReportPath } from "./finish-work-report-schema.ts";
import {
  evaluateWhenConditions,
  isReportWhenRule,
  whenIncludesPaneStatus,
  whenRuleDedupeKey,
} from "./condition-evaluator.ts";
import {
  buildContextSyncFromReport,
  enrichHandoffMessage,
  isFinishWorkHandoffCondition,
} from "./context-sync-from-report.ts";
import { evaluateHandoffProbeCondition } from "./handoff-probes.ts";
import { recordHandoffRuleEvaluation, type HandoffLogEntry } from "./handoff-log.ts";
import { homeDir } from "./paths.ts";
import {
  formatHandoffSuccessDetail,
  resolveHandoffTargetAgent,
} from "./handoff-target-resolver.ts";
import {
  parseCondition,
  resolveOrchestratorConfig,
  normalizeRemoteHostConfig,
  type HandoffRule,
  type HerdrOrchestratorConfig,
  type RemoteHostConfig,
  type RemoteDefaults,
  type ResolvedRemoteHost,
} from "./herdr-orchestrator-config.ts";
import { loadMergedHerdrDocument } from "./herdr-merged-config.ts";

export type { AgentSnapshot, AgentStatus, LeastBusyScore } from "./herdr-agent-snapshot.ts";
import type { AgentSnapshot, AgentStatus, LeastBusyScore } from "./herdr-agent-snapshot.ts";

/** A remote Herdr session discovered via SSH. */
export interface RemoteSession {
  host: string;
  sessionName: string;
  status: string;
  workspaceCount: number;
  agentCount: number;
}

/** A workspace-aware remote agent snapshot with host attribution. */
export interface RemoteAgentSnapshot extends AgentSnapshot {
  host: string;
  sessionName: string;
}

/** Parsed host:session qualified name. */
export interface HostQualifiedSession {
  host: string | null;
  session: string;
}

export interface OrchestratorState {
  schemaVersion: 1;
  updatedAt: string;
  workspaceId: string;
  agents: Record<string, { status: AgentStatus; paneId: string }>;
  /** Probe handoff rules that already fired successfully (prevents watch-events spam). */
  completedProbeHandoffs?: string[];
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

export function readState(projectRoot: string, workspaceId: string): OrchestratorState | null {
  const path = statePath(projectRoot);
  if (!pathExists(path)) return null;
  try {
    const parsed = JSON.parse(readText(path)) as OrchestratorState;
    return parsed.workspaceId === workspaceId ? parsed : null;
  } catch {
    return null;
  }
}

function writeState(projectRoot: string, state: OrchestratorState) {
  const dir = join(projectRoot, ".kimi");
  makeDir(dir, { recursive: true });
  writeText(statePath(projectRoot), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export interface WorkspaceAgentsListResult {
  ok: boolean;
  agents: AgentSnapshot[];
  error?: string;
}

export function listWorkspaceAgents(workspaceId: string, session = ""): WorkspaceAgentsListResult {
  const listed = herdrCliJson(session, ["agent", "list"]);
  if (!listed.ok) {
    return { ok: false, agents: [], error: `agent list: ${listed.error}` };
  }
  const rows = (listed.json?.result?.agents || []) as Array<{
    pane_id?: string;
    agent?: string;
    name?: string;
    agent_status?: string;
    workspace_id?: string;
    tab_id?: string;
    custom_status?: string;
  }>;
  const agents = rows
    .filter((row) => {
      const agent = row.agent ?? row.name;
      return row.workspace_id === workspaceId && row.pane_id && agent;
    })
    .map((row) => ({
      paneId: row.pane_id!,
      agent: (row.agent ?? row.name)!,
      status: (row.agent_status || "unknown") as AgentStatus,
      workspaceId,
      tabId: row.tab_id,
      customStatus: typeof row.custom_status === "string" ? row.custom_status : undefined,
    }));
  return { ok: true, agents };
}

export function listAllWorkspaceAgents(
  workspaceIds: string[],
  session = ""
): WorkspaceAgentsListResult {
  const all: AgentSnapshot[] = [];
  const errors: string[] = [];
  for (const id of workspaceIds) {
    const listed = listWorkspaceAgents(id, session);
    if (!listed.ok) {
      if (listed.error) errors.push(listed.error);
      continue;
    }
    all.push(...listed.agents);
  }
  if (errors.length > 0) {
    return { ok: false, agents: all, error: errors.join("; ") };
  }
  return { ok: true, agents: all };
}

// ── Remote Session Discovery ──────────────────────────────────────────────

/**
 * Parse a `host:session` qualified name into its components.
 * - `"workbox:dev"` → `{ host: "workbox", session: "dev" }`
 * - `"dev"` → `{ host: null, session: "dev" }`
 */
export function parseHostSession(qualified: string): HostQualifiedSession {
  const colonIdx = qualified.indexOf(":");
  if (colonIdx > 0) {
    const host = qualified.slice(0, colonIdx);
    const session = qualified.slice(colonIdx + 1);
    if (host.length > 0 && session.length > 0) {
      return { host, session };
    }
  }
  return { host: null, session: qualified };
}

export interface SshExecResult {
  ok: boolean;
  output: string;
  code?: number;
}

/**
 * Build SSH command-line args from a resolved host config.
 * Returns the argv array to append `--` and the remote command to.
 */
export function buildSshArgs(resolved: ResolvedRemoteHost): string[] {
  const args: string[] = [];

  // Core connectivity
  if (resolved.batchMode) args.push("-o", "BatchMode=yes");
  args.push("-o", `ConnectTimeout=${resolved.connectTimeout}`);
  if (resolved.port !== undefined && resolved.port !== 22) args.push("-p", String(resolved.port));
  if (resolved.user) args.push("-l", resolved.user);

  // Identity
  if (resolved.identityFile) args.push("-i", resolved.identityFile);
  if (resolved.identitiesOnly) args.push("-o", "IdentitiesOnly=yes");

  // Host key checking (always applied since resolved values exclude "ask")
  args.push("-o", `StrictHostKeyChecking=${resolved.strictHostKeyChecking}`);
  if (resolved.userKnownHostsFile) {
    args.push("-o", `UserKnownHostsFile=${resolved.userKnownHostsFile}`);
  }

  // Keep-alive
  if (resolved.serverAliveInterval > 0) {
    args.push("-o", `ServerAliveInterval=${resolved.serverAliveInterval}`);
  }
  if (resolved.serverAliveCountMax > 0) {
    args.push("-o", `ServerAliveCountMax=${resolved.serverAliveCountMax}`);
  }

  // ControlMaster multiplexing
  if (resolved.controlMaster !== "no") {
    args.push("-o", `ControlMaster=${resolved.controlMaster}`);
    if (resolved.controlPath) args.push("-o", `ControlPath=${resolved.controlPath}`);
    if (resolved.controlPersist !== undefined) {
      args.push("-o", `ControlPersist=${resolved.controlPersist}`);
    }
  }

  // Compression
  if (resolved.compression) args.push("-o", "Compression=yes");

  // ProxyJump / bastion
  if (resolved.proxyJump) args.push("-o", `ProxyJump=${resolved.proxyJump}`);

  args.push(resolved.host);
  return args;
}

/**
 * Execute a command on a remote host via SSH.
 * Uses per-host or global SSH options; falls back to BatchMode=yes, ConnectTimeout=5.
 * Includes one automatic retry on connection failure.
 */
export async function sshExec(
  resolved: ResolvedRemoteHost,
  command: string[]
): Promise<SshExecResult> {
  const args = [...buildSshArgs(resolved), "--", ...command];
  const timeoutMs = resolved.timeout;

  const run = async (): Promise<SshExecResult> => {
    try {
      const result = await governedSpawn(["ssh", ...args], {
        timeoutMs,
        retry: { maxAttempts: 1, backoffMs: 1000 },
      });
      const output = `${result.stdout}${result.stderr}`.trim();
      if (result.exitCode !== 0) {
        return { ok: false, output, code: result.exitCode };
      }
      return { ok: true, output };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, output: message, code: 1 };
    }
  };

  const first = await run();
  if (first.ok) return first;

  // Single retry on connection failure
  return run();
}

/**
 * Translate common SSH error output into a user-friendly diagnostic message.
 * Returns the original output if no known pattern matches.
 */
export function friendlySshError(output: string, host: string): string {
  const lower = output.toLowerCase();
  if (
    lower.includes("command not found") ||
    lower.includes("not found") ||
    lower.includes("no such file")
  ) {
    return `${host}: herdr not found on remote PATH`;
  }
  if (
    lower.includes("permission denied") ||
    lower.includes("authentication failed") ||
    lower.includes("publickey")
  ) {
    return `${host}: SSH authentication failed — check identity file and ssh-agent`;
  }
  if (lower.includes("connection refused")) {
    return `${host}: SSH connection refused — is the SSH server running?`;
  }
  if (lower.includes("connection timed out") || lower.includes("operation timed out")) {
    return `${host}: SSH connection timed out — check network and firewall`;
  }
  if (lower.includes("host key verification failed")) {
    return `${host}: host key changed — run 'ssh-keygen -R "${host}"' to clear`;
  }
  if (lower.includes("no route to host")) {
    return `${host}: no route to host — check DNS and network`;
  }
  if (lower.includes("broken pipe") || lower.includes("closed by remote host")) {
    return `${host}: SSH connection dropped — check keepalive settings (serverAliveInterval)`;
  }
  return output;
}

/**
 * Discover remote Herdr sessions by running `herdr session list --json` on each host.
 * Accepts raw config map (simple strings or per-host objects) and optional global defaults.
 * Returns discovered sessions or error rows for unreachable hosts.
 */
export async function discoverRemoteSessions(
  hosts: Record<string, string | RemoteHostConfig>,
  defaults?: RemoteDefaults
): Promise<{ sessions: RemoteSession[]; errors: Array<{ host: string; message: string }> }> {
  const resolvedHosts = normalizeRemoteHostConfig(hosts, defaults);
  const sessions: RemoteSession[] = [];
  const errors: Array<{ host: string; message: string }> = [];

  for (const [hostLabel, resolved] of Object.entries(resolvedHosts)) {
    // Test connectivity first
    const versionCheck = await sshExec(resolved, ["herdr", "version"]);
    if (!versionCheck.ok) {
      const msg =
        versionCheck.output.includes("command not found") ||
        versionCheck.output.includes("not found")
          ? "herdr command not found on host"
          : `unreachable`;
      errors.push({ host: hostLabel, message: `${hostLabel}: ${msg}` });
      continue;
    }

    // Discover sessions
    const sessionResult = await sshExec(resolved, ["herdr", "session", "list", "--json"]);
    if (!sessionResult.ok) {
      errors.push({ host: hostLabel, message: `${hostLabel}: failed to list sessions` });
      continue;
    }

    try {
      const parsed = JSON.parse(sessionResult.output) as {
        sessions?: Array<{ name: string; running: boolean; default: boolean; socket_path: string }>;
      };
      const hostSessions = parsed.sessions || [];
      for (const s of hostSessions) {
        // Fetch workspace count for this session
        const wsResult = await sshExec(resolved, [
          "herdr",
          "--session",
          s.name,
          "workspace",
          "list",
          "--json",
        ]);
        let workspaceCount = 0;
        let agentCount = 0;
        if (wsResult.ok) {
          try {
            const wsParsed = JSON.parse(wsResult.output) as {
              result?: { workspaces?: Array<{ workspace_id: string }> };
            };
            const workspaces = wsParsed.result?.workspaces || [];
            workspaceCount = workspaces.length;
            const agentResult = await sshExec(resolved, [
              "herdr",
              "--session",
              s.name,
              "agent",
              "list",
              "--json",
            ]);
            if (agentResult.ok) {
              try {
                const agentParsed = JSON.parse(agentResult.output) as {
                  result?: { agents?: Array<{ workspace_id?: string; agent?: string }> };
                };
                const agents = agentParsed.result?.agents || [];
                for (const ws of workspaces) {
                  agentCount += agents.filter(
                    (a) => a.workspace_id === ws.workspace_id && a.agent
                  ).length;
                }
              } catch {
                /* skip agent count */
              }
            }
          } catch {
            /* skip workspace list */
          }
        }
        sessions.push({
          host: hostLabel,
          sessionName: s.name,
          status: s.running ? "running" : "stopped",
          workspaceCount,
          agentCount,
        });
      }
    } catch {
      errors.push({
        host: hostLabel,
        message: `${hostLabel}: invalid JSON from herdr session list`,
      });
    }
  }

  return { sessions, errors };
}

/**
 * Fetch workspace agents from a remote Herdr session over SSH.
 * Accepts a resolved host config (with all SSH options pre-merged) and a label for attribution.
 */
export async function discoverRemoteWorkspaceAgents(
  hostLabel: string,
  resolved: ResolvedRemoteHost,
  session: string
): Promise<RemoteAgentSnapshot[]> {
  const agents: RemoteAgentSnapshot[] = [];

  const wsResult = await sshExec(resolved, [
    "herdr",
    "--session",
    session,
    "workspace",
    "list",
    "--json",
  ]);
  if (!wsResult.ok) return agents;

  try {
    const wsParsed = JSON.parse(wsResult.output) as {
      result?: { workspaces?: Array<{ workspace_id: string }> };
    };
    const workspaces = wsParsed.result?.workspaces || [];

    const agentResult = await sshExec(resolved, [
      "herdr",
      "--session",
      session,
      "agent",
      "list",
      "--json",
    ]);
    if (!agentResult.ok) return agents;

    try {
      const agentParsed = JSON.parse(agentResult.output) as {
        result?: {
          agents?: Array<{
            pane_id?: string;
            agent?: string;
            agent_status?: string;
            workspace_id?: string;
            tab_id?: string;
            custom_status?: string;
          }>;
        };
      };
      const allAgents = agentParsed.result?.agents || [];

      for (const ws of workspaces) {
        if (!ws.workspace_id) continue;
        const rows = allAgents.filter(
          (a) => a.workspace_id === ws.workspace_id && a.pane_id && a.agent
        );
        for (const row of rows) {
          agents.push({
            host: hostLabel,
            sessionName: session,
            paneId: row.pane_id!,
            agent: row.agent!,
            status: (row.agent_status || "unknown") as AgentStatus,
            workspaceId: ws.workspace_id!,
            tabId: row.tab_id,
            customStatus: typeof row.custom_status === "string" ? row.custom_status : undefined,
          });
        }
      }
    } catch {
      /* skip agent parse */
    }
  } catch {
    /* skip workspace parse */
  }

  return agents;
}

/** Minimum integration versions for native session restore (from Herdr preview docs). */
const RESTORE_MIN_VERSIONS: Record<string, number> = {
  pi: 2,
  claude: 6,
  codex: 5,
  cursor: 1,
  copilot: 2,
  devin: 1,
  droid: 2,
  kimi: 3,
  qodercli: 2,
  opencode: 5,
  kilo: 1,
  hermes: 2,
};

export type RestoreStatus = "native" | "replay" | "none";

export function resolveIntegrationName(source: string): string | null {
  // herdr:kimi → kimi, herdr:claude → claude
  if (source.startsWith("herdr:")) return source.slice(6);
  return null;
}

export interface AgentRestoreInfo {
  paneId: string;
  agent: string;
  source: string; // "herdr:kimi" | "reported" | "detected"
  integration: string | null; // "kimi" | "claude" | null
  integrationVersion: number | null;
  minVersion: number | null;
  restore: RestoreStatus;
  detail: string;
}

export function getRestoreReadiness(
  agentSessionMap: Map<string, string>, // paneId → agent_session.source
  integrationVersions: Map<string, { version: number; status: string }> // name → version
): (paneId: string, agent: string) => AgentRestoreInfo {
  return (paneId, agent) => {
    const source = agentSessionMap.get(paneId);
    if (!source || !source.startsWith("herdr:")) {
      return {
        paneId,
        agent,
        source: agent ? "reported" : "detected",
        integration: null,
        integrationVersion: null,
        minVersion: null,
        restore: "none",
        detail: agent ? "reported agent (no session binding)" : "detected only (screen manifest)",
      };
    }

    const name = resolveIntegrationName(source);
    const integ = name ? integrationVersions.get(name) : null;
    const minVersion = name ? (RESTORE_MIN_VERSIONS[name] ?? null) : null;

    if (!name || !integ) {
      return {
        paneId,
        agent,
        source,
        integration: name,
        integrationVersion: null,
        minVersion,
        restore: "none",
        detail: name ? `integration ${name} not installed` : `unknown source: ${source}`,
      };
    }

    if (integ.status !== "current" || !minVersion || integ.version < minVersion) {
      return {
        paneId,
        agent,
        source,
        integration: name,
        integrationVersion: integ.version,
        minVersion,
        restore: "replay",
        detail: `integration ${name} v${integ.version} (need v${minVersion} for native restore)`,
      };
    }

    return {
      paneId,
      agent,
      source,
      integration: name,
      integrationVersion: integ.version,
      minVersion,
      restore: "native",
      detail: `integration ${name} v${integ.version} (native session restore supported)`,
    };
  };
}

/** Custom-status penalty weights — higher = less desirable for handoff. */
const CUSTOM_STATUS_WEIGHTS: Record<string, number> = {
  indexing: 2,
  "running tests": 2,
  building: 2,
  deploying: 3,
};

export function findLeastBusyAgent(
  agents: AgentSnapshot[],
  excludeAgent?: string,
  labelFilter?: string,
  /** workspaceId → label → agent name */
  labelMap?: Map<string, Map<string, string>>
): LeastBusyScore | null {
  const candidates = agents.filter((a) => {
    if (a.paneId === excludeAgent) return false;
    if (labelFilter && labelMap) {
      // Only include agents whose label matches
      const wsLabels = labelMap.get(a.workspaceId);
      if (!wsLabels) return false;
      const resolved = wsLabels.get(labelFilter);
      if (resolved !== a.agent) return false;
    }
    // Exclude blocked agents from least-busy (they can't take work)
    if (a.status === "blocked") return false;
    return true;
  });

  if (!candidates.length) return null;

  const scored = candidates.map((a) => {
    let score = 0;
    const parts: string[] = [];
    switch (a.status) {
      case "idle":
        parts.push("idle=0");
        break;
      case "done":
        score = 1;
        parts.push("done=1");
        break;
      case "working":
        score = 1;
        parts.push("working=1");
        break;
      default:
        score = 1;
        parts.push(`${a.status}=1`);
    }
    // Custom-status penalty
    if (a.customStatus) {
      const weight = CUSTOM_STATUS_WEIGHTS[a.customStatus] ?? 1;
      if (weight > 0) {
        score += weight;
        parts.push(`custom:${a.customStatus}=+${weight}`);
      }
    }
    return { agent: a, score, breakdown: parts.join(" + ") };
  });

  // Sort by score ascending, then alphabetically by agent name for determinism
  scored.sort((a, b) => a.score - b.score || a.agent.agent.localeCompare(b.agent.agent));
  return scored[0]!;
}

export function parseIntegrationStatus(
  raw: string
): Map<string, { version: number; status: string }> {
  const map = new Map<string, { version: number; status: string }>();
  for (const line of raw.split("\n")) {
    const match = line.match(/^(\S+):\s+(current|outdated|not installed)(?:\s+\(v(\d+)\))?/);
    if (match) {
      const name = match[1]!;
      const status = match[2]!;
      const version = match[3] ? parseInt(match[3], 10) : 0;
      map.set(name, { version, status });
    }
  }
  return map;
}

export interface CrossWorkspaceHandoffResult {
  rule: HandoffRule;
  ok: boolean;
  detail: string;
  /** Wall-clock ms spent evaluating this rule (conditions + target resolution + send). */
  durationMs: number;
}

export interface CrossWorkspaceHandoffOptions {
  projectRoot?: string;
  home?: string;
}

export async function evaluateCrossWorkspaceHandoffs(
  config: HerdrOrchestratorConfig,
  allAgents: AgentSnapshot[],
  stateMap: Map<string, OrchestratorState | null>,
  session: string,
  /** workspaceId → label → agent name */
  labelMap?: Map<string, Map<string, string>>,
  dryRun = false,
  options: CrossWorkspaceHandoffOptions = {}
): Promise<CrossWorkspaceHandoffResult[]> {
  const results: CrossWorkspaceHandoffResult[] = [];

  const resolveSourceAgent = (
    workspaceId: string,
    nameOrLabel: string
  ): AgentSnapshot | undefined => {
    const direct = allAgents.find((a) => a.workspaceId === workspaceId && a.agent === nameOrLabel);
    if (direct) return direct;
    if (labelMap) {
      const wsLabels = labelMap.get(workspaceId);
      if (wsLabels) {
        const agentName = wsLabels.get(nameOrLabel);
        if (agentName) {
          return allAgents.find((a) => a.workspaceId === workspaceId && a.agent === agentName);
        }
      }
    }
    return undefined;
  };

  const remoteHosts = config.remoteHosts;

  for (const rule of config.handoffRules) {
    const evalStart = Date.now();
    const pushResult = (entry: Omit<CrossWorkspaceHandoffResult, "durationMs">) => {
      results.push({ ...entry, durationMs: Date.now() - evalStart });
    };

    const hasWhen = isReportWhenRule(rule.when);
    const parsed = rule.condition === "report:when" ? null : parseCondition(rule.condition);
    if (!hasWhen && !parsed) {
      pushResult({ rule, ok: false, detail: `invalid condition: ${rule.condition}` });
      continue;
    }

    // Find the source agent (by name or label)
    const fromAgent = resolveSourceAgent(rule.fromWorkspace, rule.fromAgent);
    if (!fromAgent) {
      pushResult({
        rule,
        ok: false,
        detail: `from agent/label "${rule.fromAgent}" not found in ${rule.fromWorkspace}`,
      });
      continue;
    }

    if (hasWhen) {
      if (!options.projectRoot) {
        pushResult({
          rule,
          ok: false,
          detail: "when condition requires project root",
        });
        continue;
      }
      const whenEval = await evaluateWhenConditions(options.projectRoot, rule.when!, fromAgent);
      if (!whenEval.ok) {
        pushResult({
          rule,
          ok: false,
          detail: `when not satisfied: ${whenEval.message}`,
        });
        continue;
      }
    }

    if (parsed?.kind === "probe") {
      if (!options.projectRoot) {
        pushResult({
          rule,
          ok: false,
          detail: `probe condition requires project root: ${rule.condition}`,
        });
        continue;
      }
      const probe = await evaluateHandoffProbeCondition(
        parsed.probeId,
        options.projectRoot,
        options.home
      );
      if (!probe.ok) {
        pushResult({
          rule,
          ok: false,
          detail: `probe ${parsed.probeId} not satisfied: ${probe.message}`,
        });
        continue;
      }
    } else if (parsed) {
      const paneStatusInWhen = whenIncludesPaneStatus(rule.when);
      // Check status match (skip when pane.status is already in `when`)
      if (!paneStatusInWhen && fromAgent.status !== parsed.status) {
        pushResult({
          rule,
          ok: false,
          detail: `${fromAgent.agent} (label: ${rule.fromAgent}) is ${fromAgent.status}, not ${parsed.status}`,
        });
        continue;
      }

      // Check duration if required
      if (parsed.minSeconds > 0) {
        const state = stateMap.get(rule.fromWorkspace) || null;
        const prior = state?.agents[fromAgent.agent];
        if (!prior || prior.status !== parsed.status) {
          pushResult({
            rule,
            ok: false,
            detail: `no prior ${parsed.status} state for ${fromAgent.agent}`,
          });
          continue;
        }
        const elapsed = (Date.now() - new Date(state!.updatedAt).getTime()) / 1000;
        if (elapsed < parsed.minSeconds) {
          pushResult({
            rule,
            ok: false,
            detail: `${fromAgent.agent} ${parsed.status} for ${Math.round(elapsed)}s (need ${parsed.minSeconds}s)`,
          });
          continue;
        }
      }
    }

    const targetResolved = resolveHandoffTargetAgent({
      rule,
      allAgents,
      labelMap,
      excludePaneId: fromAgent.paneId,
      findLeastBusyAgent,
    });
    let toAgent = targetResolved.agent;

    // If target agent not found and spawn_if_missing is enabled, spawn it
    if (!toAgent && rule.spawnIfMissing) {
      const toParsed = parseHostSession(rule.toSession || rule.fromSession || "");
      const remoteHosts = config.remoteHosts;

      if (toParsed.host && remoteHosts[toParsed.host]) {
        const resolvedHosts = normalizeRemoteHostConfig(
          { [toParsed.host]: remoteHosts[toParsed.host] },
          config.remoteDefaults
        );
        const resolved = resolvedHosts[toParsed.host!];
        if (resolved) {
          const sshStartResult = await sshExec(resolved, [
            "herdr",
            "--session",
            toParsed.session,
            "agent",
            "start",
            rule.toAgent,
            "--workspace",
            rule.toWorkspace,
          ]);
          if (sshStartResult.ok) {
            // Forward source agent's native session info for cross-host handoff
            // Query the source agent for agent_session data
            const fromParsed = parseHostSession(rule.fromSession || "");
            if (fromParsed.host && remoteHosts[fromParsed.host]) {
              const fromResolved = normalizeRemoteHostConfig(
                { [fromParsed.host]: remoteHosts[fromParsed.host] },
                config.remoteDefaults
              )[fromParsed.host];
              if (fromResolved) {
                const agentGetResult = await sshExec(fromResolved, [
                  "herdr",
                  "--session",
                  fromParsed.session,
                  "agent",
                  "get",
                  rule.fromAgent,
                  "--json",
                ]);
                if (agentGetResult.ok) {
                  try {
                    const agentData = JSON.parse(agentGetResult.output) as {
                      result?: { agent_session?: { id?: string; path?: string } };
                    };
                    if (
                      agentData.result?.agent_session?.id &&
                      agentData.result?.agent_session?.path
                    ) {
                      // Forward to the newly spawned target
                      await sshExec(resolved, [
                        "herdr",
                        "--session",
                        toParsed.session,
                        "pane",
                        "report-agent",
                        "last", // "last" targets the most recent pane
                        "--source",
                        "orchestrator-handoff",
                        "--agent",
                        rule.toAgent,
                        "--state",
                        "idle",
                        "--agent-session-id",
                        agentData.result.agent_session.id,
                        "--agent-session-path",
                        agentData.result.agent_session.path,
                      ]);
                    }
                  } catch {
                    /* best-effort session forwarding */
                  }
                }
              }
            }
            pushResult({
              rule,
              ok: true,
              detail: `spawned ${rule.toAgent}@${toParsed.host}:${toParsed.session} → ${rule.toWorkspace}`,
            });
          } else {
            pushResult({ rule, ok: false, detail: `spawn failed: ${sshStartResult.output}` });
          }
          continue;
        }
      }
    }

    // Check spawn_fallback: auto-spawn a new agent when no candidates exist
    if (!toAgent && rule.spawnFallback) {
      const sf = rule.spawnFallback;
      const remoteHosts = config.remoteHosts;

      if (sf.host && remoteHosts[sf.host]) {
        const resolvedHosts = normalizeRemoteHostConfig(
          { [sf.host]: remoteHosts[sf.host] },
          config.remoteDefaults
        );
        const resolved = resolvedHosts[sf.host!];
        if (resolved) {
          const targetSession = sf.session || rule.toSession || rule.fromSession || "";
          const targetWorkspace = sf.workspace || rule.toWorkspace;
          const label = sf.label || rule.toAgent || "auto-spawn";

          const startArgs: string[] = [
            "herdr",
            "--session",
            targetSession,
            "agent",
            "start",
            label,
            "--workspace",
            targetWorkspace,
          ];
          if (sf.cwd) startArgs.push("--cwd", sf.cwd);
          if (sf.split) startArgs.push("--split", sf.split);
          if (sf.tab) startArgs.push("--tab", sf.tab);

          const prefix = sf.host ? `[→${sf.host}] ` : "";

          if (dryRun) {
            pushResult({
              rule,
              ok: true,
              detail: `[dry-run] ${prefix}spawn ${sf.agentCli} as "${label}" on ${sf.host}/${targetSession}/${targetWorkspace}`,
            });
          } else {
            const spawnResult = await sshExec(resolved, startArgs);
            if (spawnResult.ok) {
              pushResult({
                rule,
                ok: true,
                detail: `${prefix}spawned ${sf.agentCli} as "${label}" on ${sf.host}/${targetSession}/${targetWorkspace}`,
              });
            } else {
              pushResult({
                rule,
                ok: false,
                detail: `${prefix}spawn failed: ${spawnResult.output}`,
              });
            }
          }
          continue;
        }
      }
      pushResult({ rule, ok: false, detail: `spawn_fallback host "${sf.host}" not configured` });
      continue;
    }

    if (!toAgent) {
      pushResult({
        rule,
        ok: false,
        detail: `to agent/label "${rule.toAgent}" not found in ${rule.toWorkspace}${
          targetResolved.strategy === "least_busy" ? " (least_busy)" : ""
        }`,
      });
      continue;
    }

    // Determine routing prefix and target session info
    const fromParsed = parseHostSession(rule.fromSession || "");
    const toParsed = parseHostSession(rule.toSession || rule.fromSession || "");
    const isRemoteFrom = fromParsed.host !== null;
    const isRemoteTo = toParsed.host !== null;

    const routePrefix =
      isRemoteFrom || isRemoteTo
        ? `[${fromParsed.host || "local"}→${toParsed.host || "local"}] `
        : "";

    if (dryRun) {
      pushResult({
        rule,
        ok: true,
        detail: `[dry-run] ${formatHandoffSuccessDetail({
          routePrefix,
          rule,
          targetPaneId: toAgent.paneId,
          targetAgentName: toAgent.agent,
          strategy: targetResolved.strategy,
        })}`,
      });
      continue;
    }

    // Build handoff message
    const recent = readAgentRecentText(fromAgent.paneId, session);
    const baseMessage = [
      `[cross-workspace handoff from ${rule.fromWorkspace}/${rule.fromAgent}]`,
      `Condition: ${rule.condition}`,
      recent || "(no recent output)",
      "",
      "Pick up from here.",
    ].join("\n");
    let message = baseMessage;
    if (options.projectRoot && (hasWhen || isFinishWorkHandoffCondition(rule.condition))) {
      const payload = buildContextSyncFromReport(options.projectRoot);
      message = enrichHandoffMessage(baseMessage, payload);
    }

    // Send — locally or via SSH
    let sent: { ok: boolean; output: string };
    if (isRemoteTo) {
      const hostConn = remoteHosts[toParsed.host!];
      if (!hostConn) {
        pushResult({ rule, ok: false, detail: `remote host "${toParsed.host}" not configured` });
        continue;
      }
      const resolvedHosts = normalizeRemoteHostConfig(
        { [toParsed.host!]: hostConn },
        config.remoteDefaults
      );
      const resolved = resolvedHosts[toParsed.host!];
      const sshResult = await sshExec(resolved, [
        "herdr",
        "--session",
        toParsed.session,
        "agent",
        "send",
        toAgent.paneId,
        message,
      ]);
      sent = { ok: sshResult.ok, output: sshResult.output };
    } else {
      sent = sendAgentText(toParsed.session || session, toAgent.paneId, message);
    }

    if (sent.ok) {
      pushResult({
        rule,
        ok: true,
        detail: formatHandoffSuccessDetail({
          routePrefix,
          rule,
          targetPaneId: toAgent.paneId,
          targetAgentName: toAgent.agent,
          strategy: targetResolved.strategy,
        }),
      });
    } else {
      pushResult({ rule, ok: false, detail: `send failed: ${sent.output}` });
    }
  }

  return results;
}

function isOneShotHandoffRule(rule: HandoffRule): boolean {
  return (
    rule.condition.startsWith("probe:") ||
    rule.condition.startsWith("finish-work:") ||
    isReportWhenRule(rule.when)
  );
}

function probeHandoffRuleKey(rule: HandoffRule): string {
  const whenKey = rule.when ? whenRuleDedupeKey(rule.when) : "";
  return `${rule.fromWorkspace}:${rule.fromAgent}:${rule.condition}:${whenKey}:${rule.toWorkspace}:${rule.toAgent}`;
}

function loadWorkspaceLabelMap(
  workspaceId: string,
  session: string
): Map<string, Map<string, string>> {
  const labelMap = new Map<string, Map<string, string>>();
  const listed = herdrCliJson(session, ["agent", "list"]);
  if (!listed.ok) return labelMap;

  const wsLabels = new Map<string, string>();
  for (const row of (listed.json?.result?.agents || []) as Array<{
    workspace_id?: string;
    name?: string;
    agent?: string;
  }>) {
    if (row.workspace_id === workspaceId && row.name && row.agent && row.name !== row.agent) {
      wsLabels.set(row.name, row.agent);
    }
  }
  if (wsLabels.size > 0) labelMap.set(workspaceId, wsLabels);
  return labelMap;
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
  if (!pathExists(path)) return null;
  try {
    return normalizeFinishWorkReport(JSON.parse(readText(path)) as Record<string, unknown>);
  } catch {
    return null;
  }
}

export async function reactHerdrOrchestrator(
  projectRoot: string,
  options: {
    session?: string;
    forceContext?: boolean;
    forceHandoff?: boolean;
    workspaceId?: string;
    /** Evaluate [[herdr.orchestrator.handoff_rules]] (watch-events only; CLI react has its own path). */
    evaluateHandoffRules?: boolean;
    dryRun?: boolean;
    /** Audit log trigger for handoff rule evaluations (default: react). */
    logTrigger?: HandoffLogEntry["trigger"];
  } = {}
): Promise<OrchestratorReactResult> {
  const warnings: string[] = [];
  const actions: OrchestratorAction[] = [];

  const config = discoverHerdrProjectConfig(projectRoot);
  if (!config?.enabled) {
    return { ok: false, workspaceId: null, actions, warnings: ["no enabled [herdr] profile"] };
  }

  const fullConfig = { ...config, projectPath: projectRoot };
  const doc = await loadMergedHerdrDocument(projectRoot, config.sourcePath);
  const orchestrator = resolveOrchestratorConfig(fullConfig, doc);
  if (!orchestrator.enabled) {
    return {
      ok: true,
      workspaceId: null,
      actions: [{ type: "skip", detail: "orchestrator disabled" }],
      warnings,
    };
  }

  const workspaceId = options.workspaceId?.trim() || null;
  const match = workspaceId
    ? { workspaceId, reason: "explicit" }
    : findWorkspaceForProject(fullConfig);
  if (!match.workspaceId) {
    return {
      ok: false,
      workspaceId: null,
      actions,
      warnings: [`workspace not open (${match.reason})`],
    };
  }

  const resolvedId = match.workspaceId;
  const session = config.session || options.session || "";
  const listed = listWorkspaceAgents(resolvedId, session);
  const agents = listed.agents;
  const previous = readState(projectRoot, resolvedId);

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
        const sync = syncAgentsTabContext(fullConfig, panes, resolvedId);
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
        const baseMessage = buildHandoffMessage(fromLabel, recent);
        const payload = buildContextSyncFromReport(projectRoot);
        const message =
          payload?.outcome === "clean" ? enrichHandoffMessage(baseMessage, payload) : baseMessage;
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

  const completedProbeHandoffs = new Set(previous?.completedProbeHandoffs ?? []);
  const defaultSession = session || "default";
  const pendingHandoffRules = orchestrator.handoffRules.filter((rule) => {
    const fromSession = rule.fromSession || defaultSession;
    if (fromSession !== defaultSession) return false;
    if (!isOneShotHandoffRule(rule)) {
      return true;
    }
    return !completedProbeHandoffs.has(probeHandoffRuleKey(rule));
  });

  if (options.evaluateHandoffRules && pendingHandoffRules.length > 0 && !handoffSent) {
    const stateMap = new Map<string, OrchestratorState | null>();
    stateMap.set(resolvedId, previous);
    const labelMap = loadWorkspaceLabelMap(resolvedId, session);
    const ruleDryRun = options.dryRun ?? false;
    const xwResults = await evaluateCrossWorkspaceHandoffs(
      { ...orchestrator, handoffRules: pendingHandoffRules },
      agents,
      stateMap,
      session,
      labelMap.size > 0 ? labelMap : undefined,
      ruleDryRun,
      { projectRoot, home: homeDir() }
    );

    const logTrigger = options.logTrigger ?? "react";
    for (const [index, xw] of xwResults.entries()) {
      recordHandoffRuleEvaluation({
        rule: xw.rule,
        ruleIndex: index + 1,
        detail: xw.detail,
        ok: xw.ok,
        trigger: logTrigger,
        fromSession: session || "default",
        toSession: session || "default",
        dryRun: ruleDryRun,
        durationMs: xw.durationMs,
        context: {
          targetStrategy: xw.rule.targetStrategy ?? "fixed",
          when: xw.rule.when?.map((row) => `${row.path}=${JSON.stringify(row.expected)}`),
          evalDurationMs: xw.durationMs,
        },
      });
    }

    for (const xw of xwResults) {
      const ruleKey = probeHandoffRuleKey(xw.rule);
      if (xw.ok) {
        actions.push({ type: "handoff", detail: `rule: ${xw.detail}` });
        handoffSent = true;
        if (!ruleDryRun && isOneShotHandoffRule(xw.rule)) {
          completedProbeHandoffs.add(ruleKey);
        }
      } else if (
        xw.detail.includes("send failed") ||
        xw.detail.includes("spawn failed") ||
        xw.detail.includes("invalid condition")
      ) {
        warnings.push(xw.detail);
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
    workspaceId: resolvedId,
    agents: Object.fromEntries(
      agents.map((row) => [row.agent, { status: row.status, paneId: row.paneId }])
    ),
    completedProbeHandoffs:
      completedProbeHandoffs.size > 0 ? [...completedProbeHandoffs] : undefined,
  };
  writeState(projectRoot, nextState);

  return { ok: warnings.length === 0, workspaceId: resolvedId, actions, warnings };
}

export async function orchestratorStatus(
  projectRoot: string,
  options: { workspaceId?: string } = {}
): Promise<{
  config: HerdrOrchestratorConfig;
  agents: AgentSnapshot[];
  state: OrchestratorState | null;
  workspaceId: string | null;
} | null> {
  const config = discoverHerdrProjectConfig(projectRoot);
  if (!config) return null;
  const fullConfig = { ...config, projectPath: projectRoot };
  const doc = await loadMergedHerdrDocument(projectRoot, config.sourcePath);
  const orchestrator = resolveOrchestratorConfig(fullConfig, doc);
  const workspaceId = options.workspaceId?.trim() || null;
  const match = workspaceId
    ? { workspaceId, reason: "explicit" }
    : findWorkspaceForProject(fullConfig);
  const resolvedId = match.workspaceId;
  const agents = resolvedId ? listWorkspaceAgents(resolvedId, config.session).agents : [];
  const state = resolvedId ? readState(projectRoot, resolvedId) : null;
  return { config: orchestrator, agents, state, workspaceId: resolvedId };
}
