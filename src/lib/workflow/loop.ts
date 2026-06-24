/**
 * workflow/loop.ts — Continuous scanner workflow loop with effect handlers.
 */

import { computeDrift } from "./drift.ts";
import { runWorkflowEffects, runWorkflowEffectsDetached, formatWorkflowReport } from "./effects.ts";
import { readSeed, writeSeedFile } from "./seed.ts";
import { resolveScanners } from "./scanners.ts";
import type {
  DriftMap,
  IssueSeverity,
  ScannerResult,
  WorkflowDomain,
  WorkflowOptions,
  WorkflowRunSummary,
  WorkflowSeedState,
} from "./types.ts";
import { startDelayedIntervalLoop, stopDelayedIntervalLoop } from "../bun-utils.ts";
import { inspectAgent } from "../inspect.ts";

const SEVERITY_RANK: Record<IssueSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export class WorkflowLoop {
  readonly domain: WorkflowDomain;
  readonly options: WorkflowOptions;
  private seedState: WorkflowSeedState | null = null;
  private watchLoop: AbortController | null = null;

  constructor(domain: WorkflowDomain, options: WorkflowOptions = {}) {
    this.domain = domain;
    this.options = options;
  }

  async loadSeed(): Promise<void> {
    if (!this.options.seedPath) return;
    this.seedState = await readSeed(this.options.seedPath);
  }

  async runScanners(): Promise<ScannerResult[]> {
    const scanners = resolveScanners(this.options.scanners);
    const results: ScannerResult[] = [];
    for (const scanner of scanners) {
      results.push(await scanner({ domain: this.domain, projectRoot: this.domain.projectRoot }));
    }
    return results;
  }

  computeDrift(results: ScannerResult[]): DriftMap | null {
    return computeDrift(results, this.seedState);
  }

  outputResults(results: ScannerResult[], drift: DriftMap | null): void {
    const output = this.options.output ?? "table";
    if (output === "json") {
      console.log(inspectAgent({ domain: this.domain.id, results, drift }, { compact: false }));
      return;
    }
    if (output === "herdr") {
      process.stderr.write(formatWorkflowReport(this.domain, results, drift));
      return;
    }

    console.error(`[${this.domain.id}] Workflow scan (${results.length} scanner(s))`);
    for (const result of results) {
      console.error(`  ${result.scannerId}: ${result.status} · ${result.issues.length} issue(s)`);
    }
    if (drift && Object.keys(drift).length > 0) {
      console.error(`  drift: ${Object.keys(drift).length} change(s)`);
    }
  }

  shouldFail(results: ScannerResult[], drift: DriftMap | null): boolean {
    if (this.options.failOnDrift && drift && Object.keys(drift).length > 0) return true;
    if (this.options.failOnIssue && results.some((row) => row.issues.length > 0)) return true;

    const threshold = this.options.failOnSeverity;
    if (threshold) {
      const minRank = SEVERITY_RANK[threshold];
      for (const result of results) {
        for (const issue of result.issues) {
          if (SEVERITY_RANK[issue.severity] >= minRank) return true;
        }
      }
    }
    return false;
  }

  private async runEffects(results: ScannerResult[], drift: DriftMap | null): Promise<void> {
    const effects = this.options.effects;
    if (!effects) return;

    if (effects.nonBlocking || this.options.watch) {
      runWorkflowEffectsDetached(this.domain, results, drift, effects, this.domain.projectRoot);
      return;
    }

    await runWorkflowEffects(this.domain, results, drift, effects, this.domain.projectRoot);
  }

  async runOnce(): Promise<WorkflowRunSummary> {
    if (this.options.seedPath) await this.loadSeed();
    const results = await this.runScanners();
    const drift = this.computeDrift(results);

    if (!this.options.dryRun) {
      this.outputResults(results, drift);
    }

    if (this.options.seedWritePath && !this.options.dryRun) {
      await writeSeedFile(this.options.seedWritePath, this.domain.id, results);
    }

    if (!this.options.dryRun) {
      await this.runEffects(results, drift);
    }

    const failed = this.shouldFail(results, drift);
    return {
      domainId: this.domain.id,
      timestamp: new Date().toISOString(),
      results,
      drift,
      failed,
    };
  }

  async runAll(): Promise<number> {
    const summary = await this.runOnce();
    if (summary.failed) return 1;

    if (!this.options.watch) return 0;

    const intervalMs = this.options.intervalMs ?? 60_000;
    await new Promise<void>((resolve) => {
      this.watchLoop = startDelayedIntervalLoop(intervalMs, async () => {
        const next = await this.runOnce();
        if (next.failed) {
          this.stop();
          resolve();
          process.exit(1);
        }
      });
    });
    return 0;
  }

  stop(): void {
    stopDelayedIntervalLoop(this.watchLoop);
    this.watchLoop = null;
  }
}
