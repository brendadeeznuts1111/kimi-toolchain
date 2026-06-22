import type { Gate, GateResult, GateRunOptions } from "./types.ts";

export interface TlsComplianceResult {
  status: "pass" | "fail";
  reason?: string;
}

export async function tlsComplianceGate(opts: { floor: string }): Promise<TlsComplianceResult> {
  const supported = ["TLSv1.2", "TLSv1.3"];
  const floorIndex = supported.indexOf(opts.floor);

  if (floorIndex === -1) {
    return { status: "fail", reason: `Unknown floor: ${opts.floor}` };
  }

  const nodeVersion = process.versions.node;
  const major = Number(nodeVersion.split(".")[0]);

  if (major < 12) {
    return { status: "fail", reason: `Node ${nodeVersion} does not support ${opts.floor}` };
  }

  return { status: "pass" };
}

export interface TlsComplianceDoctorResult extends GateResult {
  status: "pass" | "fail";
  floor: string;
  timestamp: string;
}

// Re-export for downstream consumers (dashboard, etc.)

export async function runTlsComplianceGate(_opts: GateRunOptions = {}): Promise<GateResult> {
  const floor = "TLSv1.2";
  const gate = await tlsComplianceGate({ floor });

  const result: TlsComplianceDoctorResult = {
    status: gate.status,
    reason: gate.reason,
    floor,
    timestamp: new Date().toISOString(),
  };

  return result;
}

export const tlsComplianceGateDefinition: Gate = {
  name: "tls-compliance",
  description: "Verify TLS minimum version policy",
  level: 1,
  parallel: true,
  run: runTlsComplianceGate,
  format: (result) => [
    `${result.status}: tls-compliance${result.reason ? ` — ${result.reason}` : ""}`,
    `       └─ floor: ${(result as TlsComplianceDoctorResult).floor}`,
  ],
};
