import { tlsComplianceGate } from "../../../guardian/tls-compliance.ts";

export interface DashboardTlsCompliancePayload {
  ok: boolean;
  status: "pass" | "fail";
  reason?: string;
  floor: string;
  fetchedAt: string;
}

/** Live TLS minimum-version compliance status for the dashboard. */
export async function fetchDashboardTlsCompliance(): Promise<DashboardTlsCompliancePayload> {
  const floor = "TLSv1.2";
  const result = await tlsComplianceGate({ floor });
  return {
    ok: result.status === "pass",
    status: result.status,
    reason: result.reason,
    floor,
    fetchedAt: new Date().toISOString(),
  };
}
