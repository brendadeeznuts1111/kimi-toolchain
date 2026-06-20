#!/usr/bin/env bun
// Plugin action: pull serve-probe BenchmarkApiEnvelope and register portal artifact.

import { pullBenchmarkEnvelopeAndRegister } from "../src/lib/artifact-portal.ts";

const context = safeJson(process.env.HERDR_PLUGIN_CONTEXT_JSON, {});
const cwd = context.workspace_cwd || context.workspace?.cwd || process.cwd();

console.error(
  `[dev.kimi-toolchain:benchmark-portal] workspace=${context.workspace_id || "?"} cwd=${cwd}`
);

try {
  const { envelope, record } = await pullBenchmarkEnvelopeAndRegister({ projectRoot: cwd });
  console.log(
    JSON.stringify({
      ok: true,
      runner: envelope.runner,
      gate: envelope.gates?.effectBenchmarkGate?.status,
      artifactPath: record.artifactPath,
      canvasId: record.canvasId,
    })
  );
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}

function safeJson<T>(value: string | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
