/**
 * herdr-dashboard-hub.ts — SSE agent stream, diffing, and heartbeat stale detection.
 */

import { inspectAgent } from "./inspect.ts";
import {
  fetchDashboardAgents,
  type DashboardAgentRow,
  type DashboardAgentsPayload,
  type DashboardFetchOptions,
} from "./herdr-dashboard-data.ts";

/** Sub-minute SSE poll — Bun.cron is minute-granularity; setInterval is intentional here. */
export const DASHBOARD_SSE_INTERVAL_MS = 5000;
export const DASHBOARD_STALE_MS = 15_000;

export interface DashboardHubOptions {
  projectPath: string;
  fetchOpts: DashboardFetchOptions;
  pollMs?: number;
  staleMs?: number;
}

type SseController = ReadableStreamDefaultController<Uint8Array>;

function agentKey(row: Pick<DashboardAgentRow, "host" | "session" | "agent">): string {
  return `${row.host}|${row.session}|${row.agent}`;
}

/** In-memory agent registry with SSE broadcast and heartbeat overlays. */
export class HerdrDashboardHub {
  private readonly projectPath: string;
  private readonly fetchOpts: DashboardFetchOptions;
  private readonly pollMs: number;
  private readonly staleMs: number;
  private lastAgentsJson = "";
  private lastPayload: DashboardAgentsPayload | null = null;
  private readonly heartbeats = new Map<string, number>();
  private readonly subscribers = new Set<SseController>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: DashboardHubOptions) {
    this.projectPath = options.projectPath;
    this.fetchOpts = options.fetchOpts;
    this.pollMs = options.pollMs ?? DASHBOARD_SSE_INTERVAL_MS;
    this.staleMs = options.staleMs ?? DASHBOARD_STALE_MS;
  }

  recordHeartbeat(agent: string, host = "(local)", session = ""): void {
    this.heartbeats.set(agentKey({ host, session, agent }), Date.now());
  }

  applyStaleOverlay(agents: DashboardAgentRow[]): DashboardAgentRow[] {
    const now = Date.now();
    return agents.map((row) => {
      const key = agentKey(row);
      const last = this.heartbeats.get(key);
      if (last !== undefined && now - last > this.staleMs) {
        return { ...row, status: "stale" };
      }
      return row;
    });
  }

  async refresh(): Promise<DashboardAgentsPayload> {
    const raw = await fetchDashboardAgents(this.projectPath, this.fetchOpts);
    if (!raw.ok) {
      this.lastPayload = raw;
      this.broadcast(raw);
      return raw;
    }

    const agents = this.applyStaleOverlay(raw.agents);
    const payload: DashboardAgentsPayload = {
      ...raw,
      agents,
      agentCount: agents.length,
    };
    this.lastPayload = payload;

    const json = JSON.stringify(agents);
    if (json !== this.lastAgentsJson) {
      this.lastAgentsJson = json;
      this.broadcast(payload);
    }
    return payload;
  }

  private broadcast(payload: DashboardAgentsPayload): void {
    const chunk = `data: ${inspectAgent(payload)}\n\n`;
    const bytes = new TextEncoder().encode(chunk);
    for (const controller of this.subscribers) {
      try {
        controller.enqueue(bytes);
      } catch {
        this.subscribers.delete(controller);
      }
    }
  }

  start(): void {
    if (this.pollTimer) return;
    void this.refresh();
    this.pollTimer = setInterval(() => {
      void this.refresh();
    }, this.pollMs);
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    for (const controller of this.subscribers) {
      try {
        controller.close();
      } catch {
        /* ignore */
      }
    }
    this.subscribers.clear();
  }

  private enqueuePayload(controller: SseController, payload: DashboardAgentsPayload): void {
    if (!this.subscribers.has(controller)) return;
    const chunk = `data: ${inspectAgent(payload)}\n\n`;
    try {
      controller.enqueue(new TextEncoder().encode(chunk));
    } catch {
      this.subscribers.delete(controller);
    }
  }

  createAgentsLiveStream(): ReadableStream<Uint8Array> {
    let active: SseController | null = null;
    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        active = controller;
        this.subscribers.add(controller);
        if (this.lastPayload) {
          this.enqueuePayload(controller, this.lastPayload);
          return;
        }
        void (async () => {
          const payload = await this.refresh();
          this.enqueuePayload(controller, payload);
        })();
      },
      cancel: () => {
        if (active) this.subscribers.delete(active);
      },
    });
  }
}
