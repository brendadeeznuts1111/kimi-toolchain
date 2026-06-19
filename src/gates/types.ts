export type GateStatus = "pass" | "warn" | "fail";

export interface GateRunOptions {
  projectRoot?: string;
  saveArtifact?: boolean;
}

export interface GateResult {
  status: GateStatus;
  reason?: string;
  artifactPath?: string;
}

export interface Gate {
  name: string;
  description: string;
  run: (opts?: GateRunOptions) => Promise<GateResult>;
  format?: (result: GateResult) => string[];
}
