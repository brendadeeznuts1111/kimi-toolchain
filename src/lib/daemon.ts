import { Effect, Schedule } from "effect";
import { discoverHerdrProjectConfig } from "./herdr-project-config.ts";
import {
  resolveOrchestratorConfig,
  normalizeRemoteHostConfig,
} from "./herdr-orchestrator-config.ts";
import { sshExec } from "./herdr-orchestrator.ts";
import { notifyWebhook } from "./herdr-orchestrator-remote.ts";

// ── Types ────────────────────────────────────────────────────────────────

export interface DaemonConfig {
  projectPath: string;
  /** Polling interval in seconds. */
  intervalSec?: number;
  /** If set, only operate on hosts in this domain. */
  domain?: string;
  /** Signal for graceful shutdown. */
  signal?: AbortSignal;
}

export interface DaemonTick {
  tick: number;
  hostsChecked: number;
  handoffs: number;
  spawns: number;
  errors: number;
  timestamp: string;
}

// ── Daemon ───────────────────────────────────────────────────────────────

export function daemonEffect(config: DaemonConfig): Effect.Effect<DaemonTick, never> {
  const intervalMs = (config.intervalSec || 15) * 1000;
  const schedule = Schedule.spaced(intervalMs);

  return Effect.gen(function* (_) {
    let tick = 0;

    yield* _(
      Effect.log(
        `daemon: starting (interval=${intervalMs}ms${config.domain ? `, domain=${config.domain}` : ""})`
      )
    );

    const loop = Effect.repeat(
      Effect.gen(function* (_) {
        tick++;
        const startTime = Date.now();
        let hostsChecked = 0;
        let handoffs = 0;
        let spawns = 0;
        let errors = 0;

        // 1. Load orchestrator config
        const projectConfig = yield* _(
          Effect.sync(() => discoverHerdrProjectConfig(config.projectPath))
        );

        if (!projectConfig?.enabled) {
          yield* _(Effect.logWarning("daemon: no enabled [herdr] profile"));
          return;
        }

        const full = { ...projectConfig, projectPath: config.projectPath };
        const orchConfig = resolveOrchestratorConfig(full, null);

        if (Object.keys(orchConfig.remoteHosts).length === 0) {
          yield* _(Effect.logInfo("daemon: no remote hosts configured"));
          return;
        }

        // 2. Filter hosts by domain if specified
        let targetHosts = orchConfig.remoteHosts;
        if (config.domain) {
          const members = orchConfig.domains[config.domain]?.hosts;
          if (members) {
            targetHosts = Object.fromEntries(
              Object.entries(orchConfig.remoteHosts).filter(([k]) => members.includes(k))
            );
          }
        }

        const resolved = normalizeRemoteHostConfig(targetHosts, orchConfig.remoteDefaults);

        // 3. Health check: ping all target hosts
        for (const [label, host] of Object.entries(resolved)) {
          hostsChecked++;
          const versionResult = yield* _(Effect.sync(() => sshExec(host, ["herdr", "version"])));

          if (!versionResult.ok) {
            errors++;
            yield* _(
              Effect.logWarning(
                `daemon: ${label} unreachable: ${versionResult.output.slice(0, 100)}`
              )
            );

            // Notify on error
            if (orchConfig.notifications?.onError && orchConfig.notifications.webhookUrl) {
              notifyWebhook(orchConfig.notifications.webhookUrl, {
                type: "error",
                timestamp: new Date().toISOString(),
                detail: `${label} unreachable: ${versionResult.output.slice(0, 100)}`,
                ok: false,
              });
            }
            continue;
          }

          // 4. Check agent health: count blocked/done agents
          const agentResult = yield* _(
            Effect.sync(() => sshExec(host, ["herdr", "agent", "list", "--json"]))
          );

          if (agentResult.ok) {
            try {
              const agents = JSON.parse(agentResult.output) as {
                result?: { agents?: Array<{ agent_status?: string; agent?: string }> };
              };
              const blocked = (agents.result?.agents || []).filter(
                (a) => a.agent_status === "blocked"
              );
              const done = (agents.result?.agents || []).filter((a) => a.agent_status === "done");

              if (blocked.length > 0 || done.length > 0) {
                yield* _(
                  Effect.logInfo(
                    `daemon: ${label} — ${blocked.length} blocked, ${done.length} done`
                  )
                );
              }
            } catch {
              /* best-effort */
            }
          }
        }

        const elapsed = Date.now() - startTime;
        yield* _(
          Effect.logInfo(
            `daemon: tick ${tick} — ${hostsChecked} hosts, ${elapsed}ms, ${handoffs} handoffs, ${spawns} spawns, ${errors} errors`
          )
        );
      }),
      { schedule, while: () => !config.signal?.aborted }
    );

    yield* _(loop);

    return {
      tick,
      hostsChecked: 0,
      handoffs: 0,
      spawns: 0,
      errors: 0,
      timestamp: new Date().toISOString(),
    };
  });
}
