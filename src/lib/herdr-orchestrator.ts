import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { TOML } from "bun";
import { discoverHerdrProjectConfig } from "./herdr-project-config.ts";
import { syncAgentsTabContext } from "./herdr-project-context.ts";
import { findWorkspaceForProject } from "./herdr-project-runner.ts";
import { herdrCliJson, herdrCliRun } from "./herdr-project-cli.ts";
import { escalateFinishWorkToReviewer, type FinishWorkReport } from "./finish-work-herdr.ts";
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

export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

export interface AgentSnapshot {
  paneId: string;
  agent: string;
  status: AgentStatus;
  workspaceId: string;
  tabId?: string;
  customStatus?: string;
}

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

export function readState(projectRoot: string, workspaceId: string): OrchestratorState | null {
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
    custom_status?: string;
  }>;
  return rows
    .filter((row) => row.workspace_id === workspaceId && row.pane_id && row.agent)
    .map((row) => ({
      paneId: row.pane_id!,
      agent: row.agent!,
      status: (row.agent_status || "unknown") as AgentStatus,
      workspaceId,
      tabId: row.tab_id,
      customStatus: typeof row.custom_status === "string" ? row.custom_status : undefined,
    }));
}

export function listAllWorkspaceAgents(workspaceIds: string[], session = ""): AgentSnapshot[] {
  const all: AgentSnapshot[] = [];
  for (const id of workspaceIds) {
    all.push(...listWorkspaceAgents(id, session));
  }
  return all;
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
export function sshExec(resolved: ResolvedRemoteHost, command: string[]): SshExecResult {
  const args = [...buildSshArgs(resolved), "--", ...command];
  const timeoutMs = resolved.timeout;

  const run = (): SshExecResult => {
    try {
      return {
        ok: true,
        output: execFileSync("ssh", args, {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: timeoutMs,
        }).trim(),
      };
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; status?: number };
      const combined = `${err.stdout || ""}${err.stderr || ""}`.trim();
      return {
        ok: false,
        output: combined,
        code: err.status ?? 1,
      };
    }
  };

  const first = run();
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
export function discoverRemoteSessions(
  hosts: Record<string, string | RemoteHostConfig>,
  defaults?: RemoteDefaults
): { sessions: RemoteSession[]; errors: Array<{ host: string; message: string }> } {
  const resolvedHosts = normalizeRemoteHostConfig(hosts, defaults);
  const sessions: RemoteSession[] = [];
  const errors: Array<{ host: string; message: string }> = [];

  for (const [hostLabel, resolved] of Object.entries(resolvedHosts)) {
    // Test connectivity first
    const versionCheck = sshExec(resolved, ["herdr", "version"]);
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
    const sessionResult = sshExec(resolved, ["herdr", "session", "list", "--json"]);
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
        const wsResult = sshExec(resolved, [
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
            for (const ws of workspaces) {
              const agentResult = sshExec(resolved, [
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
                  agentCount += agents.filter(
                    (a) => a.workspace_id === ws.workspace_id && a.agent
                  ).length;
                } catch {
                  /* skip agent count */
                }
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
export function discoverRemoteWorkspaceAgents(
  hostLabel: string,
  resolved: ResolvedRemoteHost,
  session: string
): RemoteAgentSnapshot[] {
  const agents: RemoteAgentSnapshot[] = [];

  const wsResult = sshExec(resolved, [
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

    for (const ws of workspaces) {
      if (!ws.workspace_id) continue;
      const agentResult = sshExec(resolved, [
        "herdr",
        "--session",
        session,
        "agent",
        "list",
        "--json",
      ]);
      if (!agentResult.ok) continue;

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
        const rows = (agentParsed.result?.agents || []).filter(
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
      } catch {
        /* skip agent parse */
      }
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

export interface LeastBusyScore {
  agent: AgentSnapshot;
  score: number;
  breakdown: string;
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
}

export function evaluateCrossWorkspaceHandoffs(
  config: HerdrOrchestratorConfig,
  allAgents: AgentSnapshot[],
  stateMap: Map<string, OrchestratorState | null>,
  session: string,
  /** workspaceId → label → agent name */
  labelMap?: Map<string, Map<string, string>>,
  dryRun = false
): CrossWorkspaceHandoffResult[] {
  const results: CrossWorkspaceHandoffResult[] = [];

  const resolveAgent = (workspaceId: string, nameOrLabel: string): AgentSnapshot | undefined => {
    // least_busy or least_busy:label
    if (nameOrLabel === "least_busy" || nameOrLabel.startsWith("least_busy:")) {
      const labelFilter = nameOrLabel.startsWith("least_busy:") ? nameOrLabel.slice(11) : undefined;
      const best = findLeastBusyAgent(allAgents, undefined, labelFilter, labelMap);
      return best?.agent;
    }
    // Direct agent name match
    const direct = allAgents.find((a) => a.workspaceId === workspaceId && a.agent === nameOrLabel);
    if (direct) return direct;
    // Label lookup
    if (labelMap) {
      const wsLabels = labelMap.get(workspaceId);
      if (wsLabels) {
        const agentName = wsLabels.get(nameOrLabel);
        if (agentName)
          return allAgents.find((a) => a.workspaceId === workspaceId && a.agent === agentName);
      }
    }
    return undefined;
  };

  const remoteHosts = config.remoteHosts;

  for (const rule of config.handoffRules) {
    const parsed = parseCondition(rule.condition);
    if (!parsed) {
      results.push({ rule, ok: false, detail: `invalid condition: ${rule.condition}` });
      continue;
    }

    // Find the source agent (by name or label)
    const fromAgent = resolveAgent(rule.fromWorkspace, rule.fromAgent);
    if (!fromAgent) {
      results.push({
        rule,
        ok: false,
        detail: `from agent/label "${rule.fromAgent}" not found in ${rule.fromWorkspace}`,
      });
      continue;
    }

    // Check status match
    if (fromAgent.status !== parsed.status) {
      results.push({
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
        results.push({
          rule,
          ok: false,
          detail: `no prior ${parsed.status} state for ${fromAgent.agent}`,
        });
        continue;
      }
      const elapsed = (Date.now() - new Date(state!.updatedAt).getTime()) / 1000;
      if (elapsed < parsed.minSeconds) {
        results.push({
          rule,
          ok: false,
          detail: `${fromAgent.agent} ${parsed.status} for ${Math.round(elapsed)}s (need ${parsed.minSeconds}s)`,
        });
        continue;
      }
    }

    // Find the target agent (by name or label)
    let toAgent = resolveAgent(rule.toWorkspace, rule.toAgent);

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
          const sshStartResult = sshExec(resolved, [
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
                const agentGetResult = sshExec(fromResolved, [
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
                      sshExec(resolved, [
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
            results.push({
              rule,
              ok: true,
              detail: `spawned ${rule.toAgent}@${toParsed.host}:${toParsed.session} → ${rule.toWorkspace}`,
            });
          } else {
            results.push({ rule, ok: false, detail: `spawn failed: ${sshStartResult.output}` });
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
            results.push({
              rule,
              ok: true,
              detail: `[dry-run] ${prefix}spawn ${sf.agentCli} as "${label}" on ${sf.host}/${targetSession}/${targetWorkspace}`,
            });
          } else {
            const spawnResult = sshExec(resolved, startArgs);
            if (spawnResult.ok) {
              results.push({
                rule,
                ok: true,
                detail: `${prefix}spawned ${sf.agentCli} as "${label}" on ${sf.host}/${targetSession}/${targetWorkspace}`,
              });
            } else {
              results.push({
                rule,
                ok: false,
                detail: `${prefix}spawn failed: ${spawnResult.output}`,
              });
            }
          }
          continue;
        }
      }
      results.push({ rule, ok: false, detail: `spawn_fallback host "${sf.host}" not configured` });
      continue;
    }

    if (!toAgent) {
      results.push({
        rule,
        ok: false,
        detail: `to agent/label "${rule.toAgent}" not found in ${rule.toWorkspace}`,
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
      const prefix =
        isRemoteFrom || isRemoteTo
          ? `[${fromParsed.host || "local"}→${toParsed.host || "local"}] `
          : "";
      results.push({
        rule,
        ok: true,
        detail: `[dry-run] ${prefix}${rule.fromWorkspace}/${fromAgent.agent} → ${rule.toWorkspace}/${toAgent.agent}`,
      });
      continue;
    }

    // Build handoff message
    const recent = readAgentRecentText(fromAgent.paneId, session);
    const message = [
      `[cross-workspace handoff from ${rule.fromWorkspace}/${rule.fromAgent}]`,
      `Condition: ${rule.condition}`,
      recent || "(no recent output)",
      "",
      "Pick up from here.",
    ].join("\n");

    // Send — locally or via SSH
    let sent: { ok: boolean; output: string };
    if (isRemoteTo) {
      const hostConn = remoteHosts[toParsed.host!];
      if (!hostConn) {
        results.push({ rule, ok: false, detail: `remote host "${toParsed.host}" not configured` });
        continue;
      }
      const resolvedHosts = normalizeRemoteHostConfig(
        { [toParsed.host!]: hostConn },
        config.remoteDefaults
      );
      const resolved = resolvedHosts[toParsed.host!];
      const sshResult = sshExec(resolved, [
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
      results.push({
        rule,
        ok: true,
        detail: `${routePrefix}${rule.fromWorkspace}/${rule.fromAgent} → ${rule.toWorkspace}/${rule.toAgent}`,
      });
    } else {
      results.push({ rule, ok: false, detail: `send failed: ${sent.output}` });
    }
  }

  return results;
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
  options: {
    session?: string;
    forceContext?: boolean;
    forceHandoff?: boolean;
    workspaceId?: string;
  } = {}
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
  const agents = listWorkspaceAgents(resolvedId, session);
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
    workspaceId: resolvedId,
    agents: Object.fromEntries(
      agents.map((row) => [row.agent, { status: row.status, paneId: row.paneId }])
    ),
  };
  writeState(projectRoot, nextState);

  return { ok: warnings.length === 0, workspaceId: resolvedId, actions, warnings };
}

export function orchestratorStatus(
  projectRoot: string,
  options: { workspaceId?: string } = {}
): {
  config: HerdrOrchestratorConfig;
  agents: AgentSnapshot[];
  state: OrchestratorState | null;
  workspaceId: string | null;
} | null {
  const config = discoverHerdrProjectConfig(projectRoot);
  if (!config) return null;
  const fullConfig = { ...config, projectPath: projectRoot };
  const doc = loadHerdrDoc(config.sourcePath);
  const orchestrator = resolveOrchestratorConfig(fullConfig, doc);
  const workspaceId = options.workspaceId?.trim() || null;
  const match = workspaceId
    ? { workspaceId, reason: "explicit" }
    : findWorkspaceForProject(fullConfig);
  const resolvedId = match.workspaceId;
  const agents = resolvedId ? listWorkspaceAgents(resolvedId, config.session) : [];
  const state = resolvedId ? readState(projectRoot, resolvedId) : null;
  return { config: orchestrator, agents, state, workspaceId: resolvedId };
}
