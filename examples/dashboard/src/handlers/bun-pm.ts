// ── Bun pm CLI mirror card (buildInstallPolicyReport + auditBunPmCliHealth) ──

import {
  auditBunPmCliHealth,
  auditRuntimeCapabilitiesHealth,
  buildInstallPolicyReport,
} from "../../../../src/lib/bun-install-config.ts";
import { jsonResponse, resolveRoot } from "./shared.ts";

export async function apiBunPm(): Promise<Response> {
  try {
    const root = resolveRoot();
    const [policyReport, pmHealth, runtimeHealth] = await Promise.all([
      buildInstallPolicyReport(root),
      auditBunPmCliHealth(root),
      auditRuntimeCapabilitiesHealth(root),
    ]);
    return jsonResponse({
      ok: pmHealth.aligned && runtimeHealth.aligned,
      applicable: pmHealth.applicable,
      aligned: pmHealth.aligned && runtimeHealth.aligned,
      bunPmCli: policyReport.runtimeCapabilities.bunPmCli,
      pmHealth,
      runtimeHealth,
      versions: policyReport.versions,
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
        bunPmCli: null,
        pmHealth: null,
        runtimeHealth: null,
        versions: null,
      },
      500
    );
  }
}
