/**
 * Dashboard API handler for the hardcoded-secret audit.
 *
 * GET /api/audit/hardcoded → JSON summary of credential-like literals.
 */
import { auditHardcodedSecrets } from "../../../../src/lib/hardcoded-secret-audit.ts";
import { resolveDashboardProjectRoot } from "../../../../src/lib/dashboard-settings.ts";
import { jsonResponse } from "./shared.ts";

export async function apiHardcodedAudit(): Promise<Response> {
  const projectRoot = resolveDashboardProjectRoot(import.meta.dir);
  const result = await auditHardcodedSecrets(projectRoot, {
    includeScripts: true,
    includeExamples: true,
  });
  return jsonResponse({
    ...result,
    ok: result.count === 0,
    fetchedAt: new Date().toISOString(),
  });
}
