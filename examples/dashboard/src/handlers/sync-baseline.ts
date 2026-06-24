// ── Sync baseline tarball metrics card ───────────────────────────────

import { readSyncBaselineMetricsWithDrift } from "../../../../src/lib/sync-baseline-metrics.ts";
import { jsonResponse, resolveRoot } from "./shared.ts";

export async function apiSyncBaseline(): Promise<Response> {
  try {
    const metrics = await readSyncBaselineMetricsWithDrift(resolveRoot());
    return jsonResponse({
      ...metrics,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse(
      {
        ok: false,
        archivePath: null,
        syncBaselineSize: 0,
        syncBaselineHash: null,
        fileCount: null,
        toolchainVersion: null,
        lastSyncedAt: null,
        error: message,
      },
      500
    );
  }
}
