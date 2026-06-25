/**
 * deferred-watch.ts — Lazy interval watch that starts only when subscribers exist.
 *
 * Bridges the gap between eager polling (herdr-dashboard/gates/gate-watch.ts) and
 * subscriber-aware execution. The watch monitors EventBus listener counts for
 * designated events: polling begins when at least one subscriber registers,
 * and stops after a grace period when the last subscriber unregisters.
 */

import { type EventBus } from "./event-bus.ts";

// ── Types ──────────────────────────────────────────────────────────

export type DeferredWatchState = "idle" | "running" | "grace";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBus = EventBus<any>;

export interface DeferredWatchOptions {
  /** Bus whose subscriber counts trigger start/stop. */
  bus: AnyBus;
  /** Events whose aggregated subscriber count (>0) activates the watch. */
  events: string[];
  /** Poll interval in ms (passed through — actual scheduling is up to onStart). */
  pollIntervalMs: number;
  /** Grace period in ms before stopping after last unsubscription. */
  gracePeriodMs: number;
  /** Called when the watch transitions idle/grace → running. */
  onStart: () => void;
  /** Called when the watch transitions grace → idle. */
  onStop: () => void;
}

export interface DeferredWatchHandle {
  state: DeferredWatchState;
  /** Manually start (bypasses subscriber check). */
  start(): void;
  /** Manually stop (bypasses grace period). */
  stop(): void;
  /** Restore original EventBus methods and stop unconditionally. */
  dispose(): void;
}

// ── Defaults ───────────────────────────────────────────────────────

const DEFAULT_GRACE_MS = 5_000;

// ── Implementation ─────────────────────────────────────────────────

/**
 * Create a deferred watch that polls only while subscribers exist for
 * the designated bus events.
 *
 * Patches `bus.on` for the target events to track subscriber counts.
 * The returned unsubscribe wrappers decrement the counter on removal.
 * A grace timer prevents thrashing: rapid unsubscribe → re-subscribe
 * cycles cancel the pending stop.
 */
export function runDeferredWatch(options: DeferredWatchOptions): DeferredWatchHandle {
  const gracePeriodMs = options.gracePeriodMs > 0 ? options.gracePeriodMs : DEFAULT_GRACE_MS;
  const events = new Set(options.events);
  const origOn = options.bus.on.bind(options.bus) as AnyBus["on"];

  let state: DeferredWatchState = "idle";
  let subscriberCount = 0;
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  // ── Grace timer management ───────────────────────────────────────

  function clearGraceTimer(): void {
    if (graceTimer !== null) {
      clearTimeout(graceTimer);
      graceTimer = null;
    }
  }

  function startGraceTimer(): void {
    clearGraceTimer();
    state = "grace";
    graceTimer = setTimeout(() => {
      graceTimer = null;
      if (disposed) return;
      if (subscriberCount > 0) {
        // A subscriber registered during the grace period — restart.
        state = "running";
        return;
      }
      state = "idle";
      options.onStop();
    }, gracePeriodMs);
  }

  // ── Transition helpers ───────────────────────────────────────────

  function onSubscriberAdded(): void {
    subscriberCount++;
    if (subscriberCount === 1) {
      clearGraceTimer();
      state = "running";
      options.onStart();
    }
  }

  function onSubscriberRemoved(): void {
    subscriberCount = Math.max(0, subscriberCount - 1);
    if (subscriberCount === 0) {
      startGraceTimer();
    }
  }

  // ── Bus patching ─────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (options.bus as any).on = function patchedOn(
    event: string,
    handler: (payload: unknown) => void
  ): () => void {
    const unsub = origOn(event, handler);
    if (!events.has(event)) return unsub;

    onSubscriberAdded();

    return () => {
      unsub();
      if (!disposed) onSubscriberRemoved();
    };
  };

  // ── Handle ───────────────────────────────────────────────────────

  function start(): void {
    if (disposed) return;
    clearGraceTimer();
    if (state === "running") return;
    state = "running";
    options.onStart();
  }

  function stop(): void {
    if (disposed) return;
    clearGraceTimer();
    if (state === "idle") return;
    state = "idle";
    options.onStop();
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    clearGraceTimer();
    if (state === "running") {
      options.onStop();
    }
    state = "idle";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (options.bus as any).on = origOn;
  }

  return {
    get state() {
      return state;
    },
    start,
    stop,
    dispose,
  };
}
