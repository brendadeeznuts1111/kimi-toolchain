/**
 * herdr-dashboard-cron.ts — Background scheduling for dashboard discovery refresh.
 *
 * Bun.cron (1.4+) uses 5 fields (minute hour day month weekday) — no seconds.
 * Sub-minute poll intervals use setInterval instead.
 */

/** Minimum interval for setInterval scheduling. */
export const DASHBOARD_INTERVAL_MIN_MS = 1000;

/** Minimum interval for Bun.cron (one minute granularity). */
export const DASHBOARD_CRON_MIN_MS = 60_000;

/** Logger surface required by the cron scheduler. */
export interface CronLogger {
  debug(message: string): void;
  info(message: string): void;
}

/** Hub surface consumed by {@link startDashboardCron}. */
export interface DashboardCronHub {
  readonly ssePollMs: number;
  refresh(): Promise<unknown>;
  logger: CronLogger;
}

/** Disposable cron handle with an imperative stop() convenience method. */
export interface DashboardCronHandle extends Disposable {
  stop(): void;
  /** The cron schedule string (or interval label for sub-minute polls). */
  readonly schedule: string;
  /** Keep the process alive while scheduled (Bun.cron default). */
  ref(): void;
  /** Allow the process to exit even while scheduled. */
  unref(): void;
}

/** Thrown when scheduling parameters are invalid. */
export class DashboardCronConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DashboardCronConfigError";
  }
}

function assertPollInterval(ms: number): void {
  if (ms < DASHBOARD_INTERVAL_MIN_MS) {
    throw new DashboardCronConfigError(
      `sse_poll_ms must be >= ${DASHBOARD_INTERVAL_MIN_MS}ms for scheduling (got ${ms})`
    );
  }
}

/**
 * Build a 5-field Bun.cron schedule from a millisecond interval (>= 1 minute).
 * @see {@link BUN_CRON_IN_PROCESS_DOC_URL} — Bun.cron uses minute hour day month weekday
 */
export function buildCronSchedule(ms: number): string {
  if (ms < DASHBOARD_CRON_MIN_MS) {
    throw new DashboardCronConfigError(
      `cron scheduling requires >= ${DASHBOARD_CRON_MIN_MS}ms (got ${ms}); use setInterval for sub-minute polls`
    );
  }
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return `*/${minutes} * * * *`;
}

/**
 * Start the dashboard discovery background poll.
 *
 * - Sub-minute intervals: setInterval
 * - >= 1 minute: Bun.cron (UTC)
 * - Skips overlapping invocations via the hub's own guard
 * - Stops when the returned Disposable is disposed
 */
export function startDashboardCron(hub: DashboardCronHub): DashboardCronHandle {
  assertPollInterval(hub.ssePollMs);

  let stopTimer: (() => void) | undefined;
  let scheduleLabel: string;

  let refTimer: (() => void) | undefined;
  let unrefTimer: (() => void) | undefined;

  if (hub.ssePollMs < DASHBOARD_CRON_MIN_MS) {
    const timer = setInterval(() => {
      void hub.refresh().catch((err: unknown) => {
        hub.logger.debug(
          `cron refresh failed: ${err instanceof Error ? err.message : String(err)}`
        );
      });
    }, hub.ssePollMs);
    stopTimer = () => clearInterval(timer);
    refTimer = () => timer.ref();
    unrefTimer = () => timer.unref();
    scheduleLabel = `interval ${hub.ssePollMs}ms`;
  } else {
    const schedule = buildCronSchedule(hub.ssePollMs);
    const job = Bun.cron(schedule, async () => {
      try {
        await hub.refresh();
      } catch (err: unknown) {
        hub.logger.debug(
          `cron refresh failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    });
    stopTimer = () => job.stop();
    refTimer = () => job.ref();
    unrefTimer = () => job.unref();
    scheduleLabel = schedule;
  }

  const dispose = (): void => {
    stopTimer?.();
    process.off("SIGTERM", onSigterm);
    process.off("SIGINT", onSigint);
    hub.logger.info("Dashboard cron stopped");
  };

  const onSigterm = (): void => {
    dispose();
  };
  const onSigint = (): void => {
    dispose();
  };

  process.once("SIGTERM", onSigterm);
  process.once("SIGINT", onSigint);

  hub.logger.info(`Dashboard cron started: ${scheduleLabel}`);

  return {
    schedule: scheduleLabel,
    ref: () => refTimer?.(),
    unref: () => unrefTimer?.(),
    [Symbol.dispose]: dispose,
    stop: dispose,
  };
}
