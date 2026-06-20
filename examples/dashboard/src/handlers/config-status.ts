// ── Configuration layers status card ────────────────────────────────

import { auditConfigLayersStatus } from "../../../../src/lib/config-status.ts";
import { jsonResponse, resolveRoot } from "./shared.ts";

export async function apiConfigStatus(): Promise<Response> {
  try {
    const report = await auditConfigLayersStatus(resolveRoot(), { withScaffold: false });
    return jsonResponse({
      ...report,
      ok: report.aligned,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse(
      {
        ok: false,
        aligned: false,
        error: message,
        gates: [],
        fixPlan: [],
      },
      500
    );
  }
}
