/** Shared harness metric types — single source of truth for monitor, gate, and HTML reporter. */

export interface Metric {
  symbol: string;
  operation: string;
  actualMs: number;
  thresholdMs: number;
  pass: boolean;
  /** Registry key (e.g. crypto.sha256) for train output. */
  registryKey?: string;
  /** Runtime unavailable — does not fail the gate. */
  skipped?: boolean;
  skipReason?: string;
}

export interface PerfGateResult {
  pass: boolean;
  failures: string[];
}

export interface ModuleRegistryEntry {
  symbol: string;
  thresholdMs: number;
  workload: () => Promise<void> | void;
  /** When true, benchmark is skipped (passes gate, not trained). */
  skipIf?: () => boolean | Promise<boolean>;
  skipReason?: string;
}

export interface TrainResult {
  written: boolean;
  path: string;
  thresholds: Record<string, number>;
}
