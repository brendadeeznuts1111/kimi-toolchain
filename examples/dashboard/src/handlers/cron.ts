// ── Cron ──────────────────────────────────────────────────────────
import { jsonResponse } from "./shared.ts";

export async function apiCron(): Promise<Response> {
  const started = Date.now();

  return new Promise((resolve) => {
    let fired = false;
    let firedAt = 0;

    const job = Bun.cron("* * * * * *", () => {
      if (!fired) {
        fired = true;
        firedAt = Date.now();
        job.stop();
        resolve(
          jsonResponse({
            pattern: "* * * * * * (every second)",
            fired: true,
            latencyMs: firedAt - started,
            note: "Bun.cron(cronExpression, callback) — native cron scheduler. job.stop() to cancel. Supports 6-field expressions with seconds.",
          })
        );
      }
    });

    // Timeout safety: resolve after 2s if cron doesn't fire
    setTimeout(() => {
      if (!fired) {
        resolve(
          jsonResponse({
            pattern: "* * * * * *",
            fired: false,
            error: "Cron did not fire within 2s",
            note: "Bun.cron may not be supported in this environment.",
          })
        );
      }
    }, 2000);
  });
}
