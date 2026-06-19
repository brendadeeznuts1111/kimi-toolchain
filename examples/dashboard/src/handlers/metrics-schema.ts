// ── Metrics Schema ─────────────────────────────────────────────────

export async function apiMetricsSchema(): Promise<Response> {
  return jsonResponse({
    Metric: {
      purpose: "Universal harness metric — drives perf-monitor, html-reporter, perf-gate",
      fields: {
        symbol: { type: "string", example: "Symbol(kimi.effect.image)", note: "Derived from sym.toString(), used for grouping" },
        operation: { type: "string", example: "thumbnail", note: "Method name from auto-discovery" },
        actualMs: { type: "number", example: 2.1, note: "Bun.nanoseconds() → ms, rounded 3 decimal places" },
        thresholdMs: { type: "number", example: 5.0, note: "From THRESHOLDS map or MODULE_REGISTRY" },
        pass: { type: "boolean", example: true, note: "actualMs ≤ thresholdMs, NaN-safe (NaN → false)" },
      },
    },
    ModuleMetrics: {
      purpose: "Lightweight control-plan metric — used in domain/control-plan.ts and training runner",
      fields: {
        name: { type: "string", example: "image", note: "Module name from registry, not symbol key" },
        actualMs: { type: "number", note: "Measured duration, threshold looked up separately" },
      },
    },
    pipeline: "auto-discovery → per-method benchmark → Metric[] → perfGate() | generatePerfHTML() | snapshot tests",
    exposure: {
      ephemeral: ["Metric[] from runEffectBenchmarks() — in-memory, lifetime of benchmark run", "ModuleMetrics[] from training runner → control-plan generator", "perfGate() → { pass, failures[] } — CI exit code logic"],
      artifacts: ["perf-report.html — generatePerfHTML(metrics) → Bun.write()", "__snapshots__/*.snap — expect(html).toMatchSnapshot()", "performance-plan.html — control-plan generator → file effect"],
      ci: ["stdout: human-readable summary", "stderr: failure lines from perfGate()", "process.exit(1) when thresholds violated"],
    },
    notOnGlobalThis: "Metrics are NOT on globalThis. Effects are registered via Symbol.for(), but Metric objects are return values — computed on demand, passed through pure transformations, optionally serialized. Domain-level data never hidden behind side effects.",
    note: "Metric[] is the single source of truth. Bun.deepEquals compares arrays across runs for drift detection (including NaN equality). All harness/reporter/gate components expect exactly these shapes.",
  });
}

