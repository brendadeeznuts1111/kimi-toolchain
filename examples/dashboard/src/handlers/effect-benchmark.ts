// ── Effect Handler Benchmark (toolchain registry) ───────────────────

import {
  appendBenchmarkSnapshot,
  evaluateEffectBenchmarkGate,
  loadMergedEffectBenchmarkThresholds,
  readBenchmarkSnapshots,
  runEffectBenchmarksReport,
  trainEffectThresholds,
} from "../../../../src/lib/effect-benchmark.ts";
import {
  buildEffectBenchmarkCardPayload,
  regressionsAgainstLatestSnapshot,
  type EffectBenchmarkCardPayload,
} from "../../../../src/lib/effect-benchmark-card.ts";
import {
  benchmarkErrorEnvelope,
  benchmarkRateLimitEnvelope,
  benchmarkSuccessEnvelope,
  checkBenchmarkPostCooldown,
  formatBenchmarkError,
  markBenchmarkPost,
} from "../../../../src/lib/effect-benchmark-resilience.ts";
import { jsonResponse } from "./api-handlers.ts";
import { resolveRoot } from "./shared.ts";

interface RunOptions {
  appendSnapshot?: boolean;
  train?: boolean;
}

const HISTORY_LIMIT = 6;

let lastGoodPayload: EffectBenchmarkCardPayload | null = null;
let lastGoodAt: string | null = null;

async function runEffectBenchmarkCard(
  options: RunOptions = {}
): Promise<EffectBenchmarkCardPayload> {
  const projectRoot = resolveRoot();
  const historyBefore = await readBenchmarkSnapshots(projectRoot, HISTORY_LIMIT);
  const previousSnapshot = historyBefore[0];

  const { sources } = await loadMergedEffectBenchmarkThresholds(projectRoot);
  const report = await runEffectBenchmarksReport({ projectRoot });
  const { metrics, errors, timedOut, partialSuccess } = report;
  const gate = await evaluateEffectBenchmarkGate(metrics, undefined, projectRoot);

  let train;
  if (options.train && gate.pass && !timedOut) {
    train = await trainEffectThresholds(metrics, projectRoot);
  } else if (options.train) {
    train = { written: false, path: "", paths: [], thresholds: {} };
  }

  let regressions = 0;
  let lastRunAt = new Date().toISOString();
  let historyAfter = historyBefore;

  if (options.appendSnapshot && metrics.length > 0) {
    regressions = await regressionsAgainstLatestSnapshot(projectRoot, metrics);
    const snapshot = await appendBenchmarkSnapshot(projectRoot, metrics);
    lastRunAt = snapshot.generatedAt;
    historyAfter = await readBenchmarkSnapshots(projectRoot, HISTORY_LIMIT);
  }

  const comparePrevious = options.appendSnapshot ? historyAfter[1] : previousSnapshot;

  return buildEffectBenchmarkCardPayload(metrics, gate, projectRoot, {
    thresholdSources: sources,
    train,
    regressions,
    snapshotCount: historyAfter.length,
    lastRunAt: options.appendSnapshot ? lastRunAt : historyAfter[0]?.generatedAt,
    historySnapshots: historyAfter,
    previousSnapshot: comparePrevious,
    partialSuccess,
    timedOut,
    errors,
  });
}

function rememberSuccess(payload: EffectBenchmarkCardPayload): void {
  lastGoodPayload = payload;
  lastGoodAt = payload.generatedAt;
}

async function respondWithCard(
  options: RunOptions = {}
): Promise<Response> {
  try {
    const payload = await runEffectBenchmarkCard(options);
    rememberSuccess(payload);
    return jsonResponse(
      benchmarkSuccessEnvelope(payload, {
        partialSuccess: payload.partialSuccess,
        timedOut: payload.timedOut,
        errors: payload.errors,
      })
    );
  } catch (error) {
    const status = lastGoodPayload ? 200 : 500;
    return jsonResponse(
      benchmarkErrorEnvelope(formatBenchmarkError(error), lastGoodPayload, lastGoodAt),
      status
    );
  }
}

function respondRateLimited(retryAfterMs: number): Response {
  return jsonResponse(
    benchmarkRateLimitEnvelope(retryAfterMs, lastGoodPayload, lastGoodAt),
    429
  );
}

function guardPost(route: "refresh" | "train"): Response | null {
  const limit = checkBenchmarkPostCooldown(route);
  if (!limit.allowed) return respondRateLimited(limit.retryAfterMs);
  markBenchmarkPost(route);
  return null;
}

export async function apiEffectBenchmark(): Promise<Response> {
  return respondWithCard();
}

export async function apiEffectBenchmarkRefresh(): Promise<Response> {
  const blocked = guardPost("refresh");
  if (blocked) return blocked;
  return respondWithCard({ appendSnapshot: true });
}

export async function apiEffectBenchmarkTrain(): Promise<Response> {
  const blocked = guardPost("train");
  if (blocked) return blocked;
  return respondWithCard({ appendSnapshot: true, train: true });
}

/** Test-only: reset cached successful payload and rate-limit clocks. */
export function resetEffectBenchmarkApiState(): void {
  lastGoodPayload = null;
  lastGoodAt = null;
}