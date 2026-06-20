// ── Effect Handler Benchmark (toolchain registry) ───────────────────

import {
  runEffectBenchmarkCardLoop,
  resetBenchmarkApiState,
} from "../../../../src/lib/effect-benchmark-card.ts";
import {
  benchmarkErrorApiEnvelope,
  benchmarkRateLimitEnvelope,
  checkBenchmarkPostCooldown,
  formatBenchmarkError,
  markBenchmarkPost,
} from "../../../../src/lib/effect-benchmark-resilience.ts";
import { jsonResponse } from "./api-handlers.ts";
import { resolveRoot } from "./shared.ts";

async function respondWithCard(options: {
  train?: boolean;
  appendSnapshot?: boolean;
}): Promise<Response> {
  try {
    const envelope = await runEffectBenchmarkCardLoop({
      projectRoot: resolveRoot(),
      runner: "dashboard",
      train: options.train,
      appendSnapshot: options.appendSnapshot,
      mapTaxonomy: true,
    });
    return jsonResponse(envelope);
  } catch (error) {
    const cached = benchmarkErrorApiEnvelope(formatBenchmarkError(error));
    return jsonResponse(cached, cached.registrySize > 0 ? 200 : 500);
  }
}

function guardPost(route: "refresh" | "train"): Response | null {
  const limit = checkBenchmarkPostCooldown(route);
  if (!limit.allowed) {
    return jsonResponse(benchmarkRateLimitEnvelope(limit.retryAfterMs), 429);
  }
  markBenchmarkPost(route);
  return null;
}

export async function apiEffectBenchmark(): Promise<Response> {
  return respondWithCard({});
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

export { resetBenchmarkApiState as resetEffectBenchmarkApiState };