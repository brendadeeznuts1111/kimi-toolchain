import { tlsComplianceGate } from "../guardian/tls-compliance.ts";
import { ArtifactStore } from "../lib/artifact-store.ts";
import type { Gate, GateResult, GateRunOptions } from "./types.ts";

export interface TlsComplianceDoctorResult extends GateResult {
  status: "pass" | "fail";
  floor: string;
  timestamp: string;
}

export async function runTlsComplianceGate(opts: GateRunOptions = {}): Promise<GateResult> {
  const projectRoot = opts.projectRoot ?? process.cwd();
  const floor = "TLSv1.2";
  const gate = await tlsComplianceGate({ floor });

  const result: TlsComplianceDoctorResult = {
    status: gate.status,
    reason: gate.reason,
    floor,
    timestamp: new Date().toISOString(),
  };

  if (opts.saveArtifact) {
    const store = new ArtifactStore(projectRoot);
    result.artifactPath = await store.save("tls-compliance", result);
  }

  return result;
}

export const tlsComplianceGateDefinition: Gate = {
  name: "tls-compliance",
  description: "Verify TLS minimum version policy",
  run: runTlsComplianceGate,
  format: (result) => [
    `${result.status}: tls-compliance${result.reason ? ` — ${result.reason}` : ""}`,
    `       └─ floor: ${(result as TlsComplianceDoctorResult).floor}`,
  ],
};
