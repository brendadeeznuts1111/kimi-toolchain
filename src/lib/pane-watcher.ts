import { Effect, Schedule } from "effect";
import { sshExec } from "./herdr-orchestrator.ts";
import type { ResolvedRemoteHost } from "./herdr-orchestrator-config.ts";

// ── Types ────────────────────────────────────────────────────────────────

export interface PaneWatcherConfig {
  /** Label for this watcher. */
  name: string;
  /** Resolved remote host to watch on. */
  resolved: ResolvedRemoteHost;
  /** Session name on the remote host. */
  session?: string;
  /** Pane ID to monitor. */
  paneId: string;
  /** Text pattern to match in pane output. */
  match: string | RegExp;
  /** Source to read from (recent, visible, recent-unwrapped, detection). */
  source?: string;
  /** How many lines to read each tick. */
  lines?: number;
  /** Polling interval in milliseconds. */
  intervalMs?: number;
  /** Action to invoke when match is found. */
  onMatch: (output: string) => Effect.Effect<void>;
  /** Signal for cancellation. */
  signal?: AbortSignal;
}

export interface PaneWatcherResult {
  name: string;
  paneId: string;
  host: string;
  matched: boolean;
  output?: string;
  error?: string;
}

// ── Core watcher ─────────────────────────────────────────────────────────

/**
 * Create an Effect that polls a remote pane for output matching a pattern.
 * Runs on the provided schedule and invokes the callback on match.
 * Stops after first match (or on signal abort).
 */
export function watchPaneOutput(
  config: PaneWatcherConfig
): Effect.Effect<PaneWatcherResult, never> {
  const source = config.source || "recent";
  const lines = config.lines || 40;
  const intervalMs = config.intervalMs || 3_000;

  const sessionArgs = config.session ? ["--session", config.session] : [];

  const schedule = Schedule.spaced(intervalMs);

  return Effect.gen(function* (_) {
    let lastOutput = "";
    let matched = false;

    // Poll until match or signal
    const readEffect = Effect.gen(function* (_) {
      const result = yield* _(
        Effect.sync(() =>
          sshExec(config.resolved, [
            "herdr",
            ...sessionArgs,
            "pane",
            "read",
            config.paneId,
            "--source",
            source,
            "--lines",
            String(lines),
          ])
        )
      );

      if (!result.ok) {
        yield* _(Effect.logWarning(`pane-read failed: ${result.output.slice(0, 120)}`));
        return;
      }

      lastOutput = result.output;

      const isMatch =
        config.match instanceof RegExp
          ? config.match.test(result.output)
          : result.output.includes(config.match);

      if (isMatch) {
        matched = true;
        yield* _(config.onMatch(result.output));
      }
    });

    yield* _(
      Effect.repeat(readEffect, {
        schedule,
        until: () => matched,
      })
    );

    return {
      name: config.name,
      paneId: config.paneId,
      host: config.resolved.host,
      matched,
      output: lastOutput,
    } satisfies PaneWatcherResult;
  });
}

// ── Multi-pane watcher ───────────────────────────────────────────────────

export interface MultiWatchConfig {
  watchers: PaneWatcherConfig[];
  /** If true, stop all watchers when any one matches. */
  stopOnFirstMatch?: boolean;
}

/**
 * Watch multiple panes in parallel. Returns results for all watchers.
 */
export function watchPanes(config: MultiWatchConfig): Effect.Effect<PaneWatcherResult[], never> {
  if (config.stopOnFirstMatch) {
    return Effect.raceAll(config.watchers.map((w) => watchPaneOutput(w))).pipe(
      Effect.map((r) => [r])
    );
  }

  return Effect.all(
    config.watchers.map((w) => watchPaneOutput(w)),
    { concurrency: "unbounded" }
  );
}

// ── Agent status watcher ─────────────────────────────────────────────────

export interface AgentStatusWatcherConfig {
  name: string;
  resolved: ResolvedRemoteHost;
  session?: string;
  /** Agent name or pane ID to watch. */
  target: string;
  /** Status to wait for. */
  status: "idle" | "working" | "blocked" | "done" | "unknown";
  /** Timeout in milliseconds. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Watch for an agent to reach a specific status on a remote host.
 */
export function watchAgentStatus(
  config: AgentStatusWatcherConfig
): Effect.Effect<{ matched: boolean; error?: string }, never> {
  return Effect.gen(function* (_) {
    const sessionArgs = config.session ? ["--session", config.session] : [];
    const timeout = config.timeoutMs || 60_000;

    const result = yield* _(
      Effect.sync(() =>
        sshExec(config.resolved, [
          "herdr",
          ...sessionArgs,
          "wait",
          "agent-status",
          config.target,
          "--status",
          config.status,
          "--timeout",
          String(timeout),
        ])
      )
    );

    if (!result.ok) {
      return { matched: false, error: result.output.slice(0, 200) };
    }

    return { matched: true };
  });
}
