import { fetchDashboardProbeCards } from "./artifacts.ts";

export interface DashboardMetricsPayload {
  ok: boolean;
  metrics: {
    memoryRssMB: number;
    memoryHeapMB: number;
    eventLoopLagMs: number;
    uptimeSeconds: number;
    sseConnections: number;
    agentCount: number;
  };
  fetchedAt: string;
}

async function measureEventLoopLagMs(): Promise<number> {
  const start = performance.now();
  await Bun.sleep(0);
  return Math.round((performance.now() - start) * 10) / 10;
}

/** Collect runtime performance metrics for the dashboard Metrics tab. */
export async function fetchDashboardMetrics(
  agentCount: number,
  sseConnections: number
): Promise<DashboardMetricsPayload> {
  const mem = process.memoryUsage();
  const uptime = process.uptime();
  const eventLoopLagMs = await measureEventLoopLagMs();

  return {
    ok: true,
    metrics: {
      memoryRssMB: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
      memoryHeapMB: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
      eventLoopLagMs,
      uptimeSeconds: Math.round(uptime),
      sseConnections,
      agentCount,
    },
    fetchedAt: new Date().toISOString(),
  };
}

// ── Health summary (lightweight status probes for header/summary cards) ─

export type DashboardHealthStatus = "ok" | "warn" | "error" | "unknown";

export interface DashboardHealthCheck {
  status: DashboardHealthStatus;
  message?: string;
}

export interface DashboardProbeHealthCheck extends DashboardHealthCheck {
  url: string;
  reachable: boolean;
  pass: number;
  fail: number;
  skip: number;
}

export interface DashboardHealthPayload {
  ok: boolean;
  checks: {
    agents: DashboardHealthCheck & { count: number };
    sse: DashboardHealthCheck & { subscribers: number };
    herdr: DashboardHealthCheck & { connected: boolean; workspaceId: string | null };
    gate: DashboardHealthCheck & { failed: boolean | null };
    probe: DashboardProbeHealthCheck;
    discovery: DashboardHealthCheck & { workspaceId: string | null };
  };
  fetchedAt: string;
}

export interface DashboardHealthInput {
  agentCount: number;
  sseSubscribers: number;
  herdrConnected: boolean;
  herdrWorkspaceId: string | null;
  herdrEnabled: boolean;
  gateFailed: boolean | null;
  discoveryWorkspaceId: string | null;
  probe?: Pick<DashboardProbeHealthCheck, "url" | "reachable" | "pass" | "fail" | "skip">;
}

/** Lightweight health snapshot for the Herdr dashboard header/summary cards. */
export function fetchDashboardHealth(input: DashboardHealthInput): DashboardHealthPayload {
  const fetchedAt = new Date().toISOString();

  const agents: DashboardHealthPayload["checks"]["agents"] = {
    status: input.agentCount > 0 ? "ok" : "warn",
    count: input.agentCount,
    message: input.agentCount > 0 ? `${input.agentCount} agent(s)` : "no agents discovered",
  };

  const sse: DashboardHealthPayload["checks"]["sse"] = {
    status: input.sseSubscribers > 0 ? "ok" : "warn",
    subscribers: input.sseSubscribers,
    message:
      input.sseSubscribers > 0
        ? `${input.sseSubscribers} subscriber(s)`
        : "no active SSE subscribers",
  };

  const herdr: DashboardHealthPayload["checks"]["herdr"] = {
    status: input.herdrEnabled ? (input.herdrConnected ? "ok" : "warn") : "unknown",
    connected: input.herdrConnected,
    workspaceId: input.herdrWorkspaceId,
    message: input.herdrEnabled
      ? input.herdrConnected
        ? `connected to ${input.herdrWorkspaceId ?? "workspace"}`
        : "herdr socket disconnected"
      : "herdr events disabled",
  };

  const gate: DashboardHealthPayload["checks"]["gate"] = {
    status: input.gateFailed === null ? "unknown" : input.gateFailed ? "error" : "ok",
    failed: input.gateFailed,
    message:
      input.gateFailed === null
        ? "gate health not yet checked"
        : input.gateFailed
          ? "effect-gates failing"
          : "effect-gates passing",
  };

  const discovery: DashboardHealthPayload["checks"]["discovery"] = {
    status: input.discoveryWorkspaceId ? "ok" : "warn",
    workspaceId: input.discoveryWorkspaceId,
    message: input.discoveryWorkspaceId
      ? `workspace ${input.discoveryWorkspaceId}`
      : "workspace not resolved",
  };

  const probeInput = input.probe;
  const probePass = probeInput?.pass ?? 0;
  const probeFail = probeInput?.fail ?? 0;
  const probeSkip = probeInput?.skip ?? 0;
  const probe: DashboardProbeHealthCheck = {
    status: !probeInput?.reachable ? "unknown" : probeFail > 0 ? "error" : "ok",
    url: probeInput?.url ?? "",
    reachable: probeInput?.reachable === true,
    pass: probePass,
    fail: probeFail,
    skip: probeSkip,
    message: !probeInput?.reachable
      ? "serve-probe offline"
      : `${probePass} pass · ${probeFail} fail · ${probeSkip} skip`,
  };

  const ok =
    agents.status !== "error" &&
    sse.status !== "error" &&
    herdr.status !== "error" &&
    gate.status !== "error" &&
    probe.status !== "error" &&
    discovery.status !== "error" &&
    agents.status !== "warn" &&
    discovery.status !== "warn";

  return {
    ok,
    checks: { agents, sse, herdr, gate, probe, discovery },
    fetchedAt,
  };
}

/** Probe serve-probe and build health input for `/api/health`. */
export async function fetchDashboardProbeHealthInput(
  projectPath: string
): Promise<NonNullable<DashboardHealthInput["probe"]>> {
  const cards = await fetchDashboardProbeCards(projectPath);
  if (!cards.reachable || !cards.summary) {
    return {
      url: cards.url,
      reachable: false,
      pass: 0,
      fail: 0,
      skip: 0,
    };
  }
  return {
    url: cards.url,
    reachable: true,
    pass: cards.summary.pass,
    fail: cards.summary.fail,
    skip: cards.summary.skip,
  };
}
