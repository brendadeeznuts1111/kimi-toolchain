// ── Cron ──────────────────────────────────────────────────────────
import { jsonResponse } from "./shared.ts";

export async function apiCron(): Promise<Response> {
  const started = Date.now();
  const pattern = "* * * * *";

  return new Promise((resolve) => {
    let fired = false;

    const job = Bun.cron(pattern, () => {
      if (!fired) {
        fired = true;
        job.stop();
        resolve(
          jsonResponse({
            pattern: `${pattern} (every minute — 5-field)`,
            fired: true,
            latencyMs: Date.now() - started,
            note: "Bun.cron uses 5 fields (minute hour day month weekday). Seconds are not supported.",
          })
        );
      }
    });

    setTimeout(() => {
      if (!fired) {
        job.stop();
        resolve(
          jsonResponse({
            pattern,
            fired: false,
            latencyMs: Date.now() - started,
            note: "Cron registered; no tick within 2s (minute-granularity). Bun.cron rejects 6-field expressions.",
          })
        );
      }
    }, 2000);
  });
}
