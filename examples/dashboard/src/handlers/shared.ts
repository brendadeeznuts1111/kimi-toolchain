/** Shared helpers for examples/dashboard API handlers (SSOT). */

import { resolveDashboardProjectRoot } from "../../../../src/lib/dashboard-settings.ts";

export function resolveRoot(): string {
  return resolveDashboardProjectRoot(import.meta.dir);
}

export function doctorBin(): string {
  const root = resolveRoot();
  return Bun.which("kimi-doctor") || `${root}/src/bin/kimi-doctor.ts`;
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
