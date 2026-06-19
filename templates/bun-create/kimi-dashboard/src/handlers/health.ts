/**
 * Health probe — runtime diagnostics.
 *
 * Bun APIs: Bun.version, Bun.revision, process.memoryUsage()
 */

import { json } from "../lib/response.ts";

export async function apiHealth(): Promise<Response> {
  return json({
    runtime: "bun",
    version: Bun.version,
    revision: Bun.revision,
    pid: process.pid,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
}
