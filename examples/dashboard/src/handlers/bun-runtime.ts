// ── Bun runtime capabilities card (auditRuntimeCapabilitiesHealth) ──

import { auditRuntimeCapabilitiesHealth } from "../../../../src/lib/bun-install-config.ts";
import { jsonResponse, resolveRoot } from "./shared.ts";

export async function apiBunRuntime(): Promise<Response> {
  try {
    const report = await auditRuntimeCapabilitiesHealth(resolveRoot());
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
        applicable: false,
        aligned: false,
        error: message,
        checks: [],
        fixPlan: [],
        runtimeApiDocs: null,
        capabilityCount: 0,
      },
      500
    );
  }
}
