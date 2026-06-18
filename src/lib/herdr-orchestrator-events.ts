import { pathExists, readText, watchPath } from "./bun-io.ts";

import { join } from "path";
import { discoverHerdrProjectConfig } from "./herdr-project-config.ts";
import { loadMergedHerdrDocument } from "./herdr-merged-config.ts";
import { syncAgentsTabContext } from "./herdr-project-context.ts";
import { findWorkspaceForProject } from "./herdr-project-runner.ts";
import { listWorkspaceAgents, reactHerdrOrchestrator } from "./herdr-orchestrator.ts";
import {
  DEFAULT_GIT_REF_COOLDOWN_MS,
  resolveOrchestratorConfig,
  type HerdrOrchestratorEventsConfig,
} from "./herdr-orchestrator-config.ts";
import { Effect } from "effect";
import {
  herdrSocketSubscribe,
  resolveHerdrSocketTransport,
  type HerdrEventSubscription,
  type HerdrStreamEnvelope,
} from "./herdr-socket-client.ts";
import { resolveHerdrSocketPath } from "./herdr-unix-socket.ts";
import {
  correlateAgentStatusChanged,
  type AgentStatusCorrelation,
} from "./herdr-alert-correlation.ts";

/** @deprecated Use DEFAULT_GIT_REF_COOLDOWN_MS from herdr-orchestrator-config.ts */
export const GIT_REF_CHANGED_COOLDOWN_MS = DEFAULT_GIT_REF_COOLDOWN_MS;

export type OrchestratorEventAction = "context-sync" | "react";

export interface OrchestratorEventDispatch {
  action: OrchestratorEventAction;
  reason: string;
}

export function normalizeHerdrEventName(event: string): string {
  if (event.includes(".")) return event;
  return event.replace(/_/g, ".");
}

export function routeOrchestratorEvent(
  envelope: HerdrStreamEnvelope,
  allowlist: string[] | null
): OrchestratorEventDispatch | null {
  const event = normalizeHerdrEventName(envelope.event || "");
  if (!event) return null;

  const data = envelope.data || {};
  const customStatus = typeof data.custom_status === "string" ? data.custom_status : undefined;

  let logical = event;
  if (customStatus === "effect.gates.changed") logical = "effect.gates.changed";
  if (customStatus === "workspace.updated") logical = "workspace.updated";
  if (customStatus === "reviewer.feedback.processed") logical = "reviewer.feedback.processed";

  if (allowlist && !allowlist.includes(logical) && !allowlist.includes(event)) {
    return null;
  }

  if (logical === "workspace.updated" || event === "workspace.updated") {
    return { action: "context-sync", reason: "workspace.updated" };
  }

  if (logical === "reviewer.feedback.processed") {
    return { action: "context-sync", reason: "reviewer.feedback.processed" };
  }

  if (logical === "git.ref.changed") {
    return { action: "context-sync", reason: "git.ref.changed" };
  }

  if (logical === "effect.gates.changed") {
    return { action: "react", reason: "effect.gates.changed" };
  }

  if (event === "pane.agent_status_changed" || event === "pane.agent.status.changed") {
    return { action: "react", reason: "pane.agent_status_changed" };
  }

  return null;
}

class DebouncedOrchestratorActions {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  schedule(key: string, debounceMs: number, fn: () => void | Promise<void>) {
    const existing = this.timers.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.timers.delete(key);
      void fn();
    }, debounceMs);
    this.timers.set(key, timer);
  }

  clear() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}

function readGitHead(projectRoot: string): string | null {
  const headPath = join(projectRoot, ".git", "HEAD");
  if (!pathExists(headPath)) return null;
  try {
    const raw = readText(headPath).trim();
    if (raw.startsWith("ref: ")) {
      const refPath = join(projectRoot, ".git", raw.slice(5).trim());
      if (pathExists(refPath)) return readText(refPath).trim();
    }
    return raw;
  } catch {
    return null;
  }
}

export function gitRefChangedThrottleKey(projectRoot: string, head: string): string {
  return `${projectRoot}:${head}`;
}

/** True when the same (repo, ref) was emitted inside the cooldown window. */
export function shouldThrottleGitRefChanged(
  projectRoot: string,
  head: string,
  lastEmitByKey: ReadonlyMap<string, number>,
  nowMs = Date.now(),
  cooldownMs = GIT_REF_CHANGED_COOLDOWN_MS
): boolean {
  const key = gitRefChangedThrottleKey(projectRoot, head);
  const last = lastEmitByKey.get(key) ?? 0;
  return nowMs - last < cooldownMs;
}

export function markGitRefChangedEmitted(
  projectRoot: string,
  head: string,
  lastEmitByKey: Map<string, number>,
  nowMs = Date.now()
): void {
  lastEmitByKey.set(gitRefChangedThrottleKey(projectRoot, head), nowMs);
}

function resolveGitHeadWatchPath(projectRoot: string): string | null {
  const headPath = join(projectRoot, ".git", "HEAD");
  if (!pathExists(headPath)) return null;
  try {
    const raw = readText(headPath).trim();
    if (raw.startsWith("ref: ")) {
      const refPath = join(projectRoot, ".git", raw.slice(5).trim());
      return pathExists(refPath) ? refPath : headPath;
    }
    return headPath;
  } catch {
    return null;
  }
}

/** Herdr socket subscriptions for a workspace (shared by watch-events and dashboard bridge). */
export function buildHerdrWorkspaceEventSubscriptions(
  workspaceId: string,
  paneIds: string[]
): HerdrEventSubscription[] {
  void workspaceId;
  const subs: HerdrEventSubscription[] = [{ type: "workspace.updated" }];
  for (const paneId of paneIds) {
    subs.push({ type: "pane.agent_status_changed", pane_id: paneId });
  }
  return subs;
}

export interface WatchOrchestratorEventsOptions {
  json?: boolean;
  signal?: AbortSignal;
  onDispatch?: (dispatch: OrchestratorEventDispatch) => void;
  /** Read-only taxonomy correlation on pane.agent_status_changed (Wave C). */
  correlateAgentStatus?: boolean;
}

export interface WatchOrchestratorEventsResult {
  ok: boolean;
  workspaceId: string | null;
  subscriptions: HerdrEventSubscription[];
  error?: string;
}

async function runDispatch(
  projectRoot: string,
  dispatch: OrchestratorEventDispatch,
  events: HerdrOrchestratorEventsConfig,
  workspaceId: string
) {
  const config = discoverHerdrProjectConfig(projectRoot);
  if (!config?.enabled) return;

  const full = { ...config, projectPath: projectRoot };

  if (dispatch.action === "context-sync") {
    syncAgentsTabContext(full, full.agentsTab?.panes, workspaceId, {
      appendFinishWorkBrief:
        dispatch.reason === "workspace.updated" ||
        dispatch.reason === "reviewer.feedback.processed",
    });
    if (dispatch.reason === "workspace.updated") {
      await reactHerdrOrchestrator(projectRoot, {
        workspaceId,
        evaluateHandoffRules: true,
        logTrigger: "watch-events",
      });
    }
    return;
  }

  await reactHerdrOrchestrator(projectRoot, {
    forceContext: events.allowlist?.includes("effect.gates.changed") ?? true,
    evaluateHandoffRules: true,
    logTrigger: "watch-events",
  });
}

export function watchOrchestratorEventsEffect(
  projectRoot: string,
  options: WatchOrchestratorEventsOptions = {}
): Effect.Effect<WatchOrchestratorEventsResult, never> {
  return Effect.async<WatchOrchestratorEventsResult>((resume) => {
    void runWatchOrchestratorEvents(projectRoot, options, resume);
  });
}

async function runWatchOrchestratorEvents(
  projectRoot: string,
  options: WatchOrchestratorEventsOptions,
  resume: (effect: Effect.Effect<WatchOrchestratorEventsResult, never>) => void
): Promise<void> {
  const config = discoverHerdrProjectConfig(projectRoot);
  if (!config?.enabled) {
    resume(
      Effect.succeed({
        ok: false,
        workspaceId: null,
        subscriptions: [],
        error: "no enabled [herdr] profile",
      })
    );
    return;
  }

  const full = { ...config, projectPath: projectRoot };
  const doc = await loadMergedHerdrDocument(projectRoot, config.sourcePath);
  const orchestrator = resolveOrchestratorConfig(full, doc);
  if (!orchestrator.enabled || !orchestrator.events.enabled) {
    resume(
      Effect.succeed({
        ok: false,
        workspaceId: null,
        subscriptions: [],
        error: "orchestrator events disabled",
      })
    );
    return;
  }

  const match = findWorkspaceForProject(full);
  if (!match.workspaceId) {
    resume(
      Effect.succeed({
        ok: false,
        workspaceId: null,
        subscriptions: [],
        error: `workspace not open (${match.reason})`,
      })
    );
    return;
  }

  const workspaceId = match.workspaceId;
  const boundSession = config.session;
  const listed = listWorkspaceAgents(workspaceId, boundSession);
  if (!listed.ok) {
    resume(
      Effect.succeed({
        ok: false,
        workspaceId: null,
        subscriptions: [],
        error: listed.error || "agent list failed",
      })
    );
    return;
  }
  const agents = listed.agents;
  const paneIds = [...new Set(agents.map((row) => row.paneId))];
  const subscriptions = buildHerdrWorkspaceEventSubscriptions(workspaceId, paneIds);
  const debouncer = new DebouncedOrchestratorActions();
  const eventsConfig = orchestrator.events;

  const emit = (dispatch: OrchestratorEventDispatch, correlation?: AgentStatusCorrelation) => {
    options.onDispatch?.(dispatch);
    if (options.json) {
      process.stdout.write(
        `${JSON.stringify({
          schemaVersion: 1,
          tool: "herdr-orchestrator",
          mode: "watch-events",
          at: new Date().toISOString(),
          ...dispatch,
          ...(correlation ? { correlation } : {}),
        })}\n`
      );
    } else {
      const hitCount = correlation?.hits.length ?? 0;
      const suffix =
        correlation && hitCount > 0
          ? ` (${hitCount} taxonomy hit${hitCount === 1 ? "" : "s"})`
          : "";
      process.stdout.write(`event → ${dispatch.action}: ${dispatch.reason}${suffix}\n`);
    }
  };

  const queue = (dispatch: OrchestratorEventDispatch, envelope?: HerdrStreamEnvelope) => {
    debouncer.schedule(dispatch.action, eventsConfig.debounceMs, async () => {
      let correlation: AgentStatusCorrelation | undefined;
      if (
        options.correlateAgentStatus !== false &&
        dispatch.reason === "pane.agent_status_changed" &&
        envelope?.data
      ) {
        correlation = await correlateAgentStatusChanged(envelope.data as Record<string, unknown>);
      }
      emit(dispatch, correlation);
      await runDispatch(projectRoot, dispatch, eventsConfig, workspaceId);
    });
  };

  let gitWatcher: ReturnType<typeof watchPath> | null = null;
  let gitHead = readGitHead(projectRoot);
  const gitRefLastEmit = new Map<string, number>();

  if (eventsConfig.watchGit) {
    const gitHeadPath = resolveGitHeadWatchPath(projectRoot);
    if (gitHeadPath && pathExists(gitHeadPath)) {
      gitWatcher = watchPath(gitHeadPath, () => {
        const next = readGitHead(projectRoot);
        if (!next || next === gitHead) return;
        if (
          shouldThrottleGitRefChanged(
            projectRoot,
            next,
            gitRefLastEmit,
            Date.now(),
            eventsConfig.gitRefCooldownMs
          )
        ) {
          return;
        }
        gitHead = next;
        markGitRefChangedEmitted(projectRoot, next, gitRefLastEmit);
        const routed = routeOrchestratorEvent(
          { event: "git.ref.changed", data: { head: next } },
          eventsConfig.allowlist
        );
        if (routed) queue(routed);
      });
    }
  }

  if (!options.json) {
    const sessionLabel =
      boundSession?.trim() && boundSession !== "default" ? boundSession : "default";
    const socketPath = resolveHerdrSocketPath(boundSession);
    const mode = resolveHerdrSocketTransport();
    const transportHint =
      mode === "auto" ? "auto (ws+unix → jsonl)" : mode === "websocket" ? "ws+unix" : "jsonl";
    process.stdout.write(
      `watch-events: session ${sessionLabel}, transport ${transportHint}, socket ${socketPath}, workspace ${workspaceId}, ${subscriptions.length} subscription(s)\n`
    );
  }

  let settled = false;
  const finish = (result: WatchOrchestratorEventsResult) => {
    if (settled) return;
    settled = true;
    gitWatcher?.close();
    debouncer.clear();
    resume(Effect.succeed(result));
  };

  const socket = herdrSocketSubscribe({
    subscriptions,
    session: boundSession,
    signal: options.signal,
    onError: (error) => {
      finish({ ok: false, workspaceId, subscriptions, error });
    },
    onEvent: (envelope) => {
      const data = envelope.data || {};
      const eventWorkspace =
        typeof data.workspace_id === "string"
          ? data.workspace_id
          : typeof (data.workspace as { workspace_id?: string } | undefined)?.workspace_id ===
              "string"
            ? (data.workspace as { workspace_id: string }).workspace_id
            : undefined;

      if (eventWorkspace && eventWorkspace !== workspaceId) return;

      const routed = routeOrchestratorEvent(envelope, eventsConfig.allowlist);
      if (routed) queue(routed, envelope);
    },
  });

  socket.on("close", () => {
    if (options.signal?.aborted) {
      finish({ ok: true, workspaceId, subscriptions });
      return;
    }
    finish({ ok: false, workspaceId, subscriptions, error: "event stream closed" });
  });

  if (options.signal) {
    options.signal.addEventListener(
      "abort",
      () => {
        socket.end();
        finish({ ok: true, workspaceId, subscriptions });
      },
      { once: true }
    );
  }
}
