import { describe, expect, it, beforeEach } from "bun:test";
import {
  buildBenchmarkApiEnvelope,
  buildEffectBenchmarkCardPayload,
  benchmarkErrorApiEnvelope,
  rememberLastGoodEnvelope,
  resetBenchmarkApiState,
} from "../src/lib/effect-benchmark-card.ts";
import {
  checkBenchmarkPostCooldown,
  benchmarkRateLimitEnvelope,
  markBenchmarkPost,
  resetBenchmarkPostCooldown,
} from "../src/lib/effect-benchmark-resilience.ts";
import type { Metric } from "../src/harness/html-reporter.ts";

const sampleMetric = (): Metric => ({
  symbol: "kimi.effect.crypto",
  operation: "sha256",
  actualMs: 0.01,
  thresholdMs: 0.01,
  pass: true,
  registryKey: "crypto.sha256",
});

describe("effect-benchmark-resilience", () => {
  beforeEach(() => {
    resetBenchmarkPostCooldown();
    resetBenchmarkApiState();
  });

  it("enforces post cooldown per route", () => {
    markBenchmarkPost("refresh");
    const blocked = checkBenchmarkPostCooldown("refresh", 1000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    const other = checkBenchmarkPostCooldown("train", 1000);
    expect(other.allowed).toBe(true);
  });

  it("builds rate-limit envelope with cached payload", () => {
    const payload = buildEffectBenchmarkCardPayload(
      [sampleMetric()],
      { pass: true, failures: [] },
      "/tmp"
    );
    const envelope = buildBenchmarkApiEnvelope(payload, {
      runner: "dashboard",
      thresholdSource: "baseline",
      gate: { pass: true, failures: [] },
    });
    rememberLastGoodEnvelope(envelope);
    const limited = benchmarkRateLimitEnvelope(2500);
    expect(limited.ok).toBe(false);
    expect(limited.retryAfterMs).toBe(2500);
    expect(limited.registrySize).toBe(1);
    expect(limited.requestError).toContain("Rate limited");
  });

  it("builds error envelope preserving last successful data", () => {
    const payload = buildEffectBenchmarkCardPayload(
      [sampleMetric()],
      { pass: true, failures: [] },
      "/tmp"
    );
    const envelope = buildBenchmarkApiEnvelope(payload, {
      runner: "kimi-doctor",
      thresholdSource: "baseline",
      gate: { pass: true, failures: [] },
    });
    rememberLastGoodEnvelope(envelope);
    const err = benchmarkErrorApiEnvelope("benchmark crashed");
    expect(err.ok).toBe(false);
    expect(err.requestError).toBe("benchmark crashed");
    expect(err.metrics).toHaveLength(1);
    expect(err.metadata.cacheHit).toBe(true);
  });
});
