export type GateStatus = "pass" | "warn" | "fail";

/** Artifact from the current run or {@link ArtifactStore} fallback. */
export interface GateArtifact {
  gate: string;
  path?: string;
  relativePath?: string;
  payload: unknown;
}

export interface GateRunOptions {
  projectRoot?: string;
  saveArtifact?: boolean;
  /** Read a dependency gate result from the current run or latest saved artifact. */
  getArtifact?: (gateName: string) => Promise<GateArtifact | null>;
}

export interface GateResult {
  status: GateStatus;
  reason?: string;
  artifactPath?: string;
}

export interface Gate {
  name: string;
  description: string;
  /** Gates that must run (and pass) before this one. */
  dependsOn?: string[];
  run: (opts?: GateRunOptions) => Promise<GateResult>;
  format?: (result: GateResult) => string[];
}
