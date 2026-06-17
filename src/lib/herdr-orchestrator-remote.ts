import { sshExec } from "./herdr-orchestrator.ts";
import {
  resolveOrchestratorConfig,
  normalizeRemoteHostConfig,
  type ResolvedRemoteHost,
  type RemoteHostConfig,
  type RemoteDefaults,
} from "./herdr-orchestrator-config.ts";

// ── Types ────────────────────────────────────────────────────────────────

export interface RemoteActionContext {
  resolved: ResolvedRemoteHost;
  session?: string;
  workspace?: string;
  env?: Record<string, string>;
}

export interface RemoteError {
  type:
    | "ssh-connection"
    | "ssh-auth"
    | "remote-not-found"
    | "remote-timeout"
    | "remote-parse"
    | "unknown";
  message: string;
  code?: number;
  host: string;
}

export interface RemoteActionResult {
  ok: boolean;
  output: string;
  error?: RemoteError;
  action: string;
  hostLabel: string;
}

function classifySshError(output: string, host: string): RemoteError {
  const lower = output.toLowerCase();
  if (lower.includes("command not found") || lower.includes("not found")) {
    return { type: "remote-not-found", message: `herdr not found on ${host}`, host };
  }
  if (lower.includes("permission denied") || lower.includes("publickey")) {
    return { type: "ssh-auth", message: `SSH auth failed for ${host}`, host };
  }
  if (lower.includes("connection refused")) {
    return { type: "ssh-connection", message: `SSH connection refused to ${host}`, host };
  }
  if (lower.includes("timed out")) {
    return { type: "remote-timeout", message: `SSH timed out connecting to ${host}`, host };
  }
  return { type: "unknown", message: output.slice(0, 200), host };
}

// ── Helpers ──────────────────────────────────────────────────────────────

function herdrPrefix(session?: string): string[] {
  if (session) return ["herdr", "--session", session];
  return ["herdr"];
}

// ── Core: invoke a plugin action on a remote host ────────────────────────

export function invokeRemoteAction(
  actionId: string,
  context: RemoteActionContext,
  args: string[] = []
): RemoteActionResult {
  const { resolved, session, workspace, env = {} } = context;

  const cmd = [...herdrPrefix(session), "plugin", "action", "invoke", actionId];

  if (workspace) cmd.push("--workspace", workspace);
  for (const [key, value] of Object.entries(env)) {
    cmd.push("--env", `${key}=${value}`);
  }
  cmd.push(...args);

  const result = sshExec(resolved, cmd);
  if (!result.ok) {
    return {
      ok: false,
      output: result.output,
      error: classifySshError(result.output, resolved.host),
      action: actionId,
      hostLabel: resolved.host,
    };
  }

  return { ok: true, output: result.output, action: actionId, hostLabel: resolved.host };
}

// ── Convenience: agent lifecycle ─────────────────────────────────────────

export function remoteAgentStart(
  resolved: ResolvedRemoteHost,
  agentName: string,
  session?: string,
  workspace?: string
): RemoteActionResult {
  return invokeRemoteAction(
    "agent-manager.start",
    { resolved, session, workspace, env: { AGENT_NAME: agentName } },
    [agentName]
  );
}

export function remoteAgentStop(
  resolved: ResolvedRemoteHost,
  agentName: string,
  session?: string
): RemoteActionResult {
  return invokeRemoteAction(
    "agent-manager.stop",
    { resolved, session, env: { AGENT_NAME: agentName } },
    [agentName]
  );
}

export function remoteAgentAttach(
  resolved: ResolvedRemoteHost,
  agentName: string,
  session?: string
): RemoteActionResult {
  return invokeRemoteAction(
    "agent-manager.attach",
    { resolved, session, env: { AGENT_NAME: agentName } },
    [agentName]
  );
}

// ── Convenience: bootstrap ───────────────────────────────────────────────

export function remoteBootstrap(
  resolved: ResolvedRemoteHost,
  pluginRepo = "ogulcancelik/herdr-orchestrator-agent-manager",
  ref?: string
): RemoteActionResult[] {
  const results: RemoteActionResult[] = [];

  // Install
  const installArgs = ["--yes"];
  if (ref) installArgs.push("--ref", ref);
  const installResult = invokeRemoteAction("plugin.install", { resolved }, [
    pluginRepo,
    ...installArgs,
  ]);
  results.push(installResult);
  if (!installResult.ok) return results;

  // Enable
  const enableResult = invokeRemoteAction("plugin.enable", { resolved }, [pluginRepo]);
  results.push(enableResult);

  return results;
}

// ── Resolve a label to a ResolvedRemoteHost from config ──────────────────

export function resolveHost(
  hostLabel: string,
  remoteHosts: Record<string, string | RemoteHostConfig>,
  remoteDefaults?: RemoteDefaults
): ResolvedRemoteHost | null {
  const rawConfig = remoteHosts[hostLabel];
  if (!rawConfig) return null;
  const resolved = normalizeRemoteHostConfig({ [hostLabel]: rawConfig }, remoteDefaults);
  return resolved[hostLabel] ?? null;
}

export function resolveAllHosts(
  remoteHosts: Record<string, string | RemoteHostConfig>,
  remoteDefaults?: RemoteDefaults
): Map<string, ResolvedRemoteHost> {
  const map = new Map<string, ResolvedRemoteHost>();
  const resolved = normalizeRemoteHostConfig(remoteHosts, remoteDefaults);
  for (const [label, host] of Object.entries(resolved)) {
    map.set(label, host);
  }
  return map;
}

// ── Notifications webhook ────────────────────────────────────────────────

export interface NotifyEvent {
  type: "handoff" | "spawn" | "spawn-fallback" | "error" | "dry-run" | "health";
  timestamp: string;
  fromAgent?: string;
  fromWorkspace?: string;
  fromHost?: string;
  toAgent?: string;
  toWorkspace?: string;
  toHost?: string;
  condition?: string;
  detail: string;
  ok: boolean;
  hostname?: string;
  domain?: string;
  metadata?: Record<string, string>;
}

export interface NotifyOptions {
  /** Max retries on failure. Default 2. */
  maxRetries?: number;
  /** Delay between retries in ms. Default 1000. */
  retryDelayMs?: number;
}

/**
 * Send a webhook notification with retry logic.
 * Returns after first successful delivery or after maxRetries failures.
 */
export function notifyWebhook(
  webhookUrl: string,
  event: NotifyEvent,
  options: NotifyOptions = {}
): void {
  if (!webhookUrl) return;

  const maxRetries = options.maxRetries ?? 2;
  const retryDelayMs = options.retryDelayMs ?? 1_000;

  const payload = {
    source: "herdr-orchestrator",
    event: event.type,
    timestamp: event.timestamp,
    ok: event.ok,
    from: event.fromAgent
      ? {
          agent: event.fromAgent,
          workspace: event.fromWorkspace,
          host: event.fromHost,
        }
      : null,
    to: event.toAgent
      ? {
          agent: event.toAgent,
          workspace: event.toWorkspace,
          host: event.toHost,
        }
      : null,
    condition: event.condition,
    detail: event.detail,
    hostname: event.hostname || "",
    domain: event.domain || "",
    metadata: event.metadata || {},
  };

  const attempt = (retriesLeft: number) => {
    fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then((res: any) => {
        if (res.status >= 400 && retriesLeft > 0) {
          setTimeout(() => attempt(retriesLeft - 1), retryDelayMs);
        }
      })
      .catch(() => {
        if (retriesLeft > 0) {
          setTimeout(() => attempt(retriesLeft - 1), retryDelayMs);
        }
      });
  };

  try {
    attempt(maxRetries);
  } catch {
    // Silent — fire and forget
  }
}
