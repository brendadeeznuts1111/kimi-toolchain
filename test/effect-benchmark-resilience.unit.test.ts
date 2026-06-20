import { describe, expect, it, beforeEach } from "bun:test";
import {
  benchmarkErrorEnvelope,
  benchmarkRateLimitEnvelope,
  benchmarkSuccessEnvelope,
  checkBenchmarkPostCooldown,
  markBenchmarkPost,
  resetBenchmarkPostCooldown,
} from "../src/lib/effect-benchmark-resilience.ts";
import { buildEffectBenchmarkCardPayload } from "../src/lib/effect-benchmark-card.ts";
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
    const envelope = benchmarkRateLimitEnvelope(2500, payload, payload.generatedAt);
    expect(envelope.ok).toBe(false);
    expect(envelope.retryAfterMs).toBe(2500);
    expect(envelope.registrySize).toBe(1);
    expect(envelope.requestError).toContain("Rate limited");
  });

  it("builds error envelope preserving last successful data", () => {
    const payload = buildEffectBenchmarkCardPayload(
      [sampleMetric()],
      { pass: true, failures: [] },
      "/tmp"
    );
    const envelope = benchmarkErrorEnvelope("benchmark crashed", payload, payload.generatedAt);
    expect(envelope.ok).toBe(false);
    expect(envelope.requestError).toBe("benchmark crashed");
    expect(envelope.metrics).toHaveLength(1);
    expect(envelope.lastSuccessfulAt).toBe(payload.generatedAt);
  });

  it("wraps success payload with resilience metadata", () => {
    const payload = buildEffectBenchmarkCardPayload(
      [sampleMetric()],
      { pass: false, failures: ["fail"] },
      "/tmp",
      { partialSuccess: true, timedOut: false, errors: [{ registryKey: "x", message: "boom" }] }
    );
    const envelope = benchmarkSuccessEnvelope(payload, {
      partialSuccess: true,
      errors: [{ registryKey: "x", message: "boom" }],
    });
    expect(envelope.ok).toBe(true);
    expect(envelope.partialSuccess).toBe(true);
    expect(envelope.errors).toHaveLength(1);
  });
});