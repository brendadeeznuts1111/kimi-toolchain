// ── Sleep ──────────────────────────────────────────────────────────
import { jsonResponse } from "./shared.ts";

export async function apiSleep(): Promise<Response> {
  const start = Bun.nanoseconds();
  await Bun.sleep(10);
  const end = Bun.nanoseconds();

  return jsonResponse({
    requested: "10ms",
    start: Number(start),
    end: Number(end),
    actual: `${Number(end - start) / 1_000_000}ms`,
    note: "Bun.sleep(ms) — non-blocking sleep. Uses monotonic clock internally.",
  });
}
