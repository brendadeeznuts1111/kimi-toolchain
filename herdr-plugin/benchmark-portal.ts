#!/usr/bin/env bun
// Plugin action: full Artifact Portal publish — same path as bun run build:portal.

import { buildArtifactPortal } from "../src/lib/artifact-portal.ts";

const context = safeJson(process.env.HERDR_PLUGIN_CONTEXT_JSON, {});
const cwd = context.workspace_cwd || context.workspace?.cwd || process.cwd();

console.error(
  `[dev.kimi-toolchain:benchmark-portal] workspace=${context.workspace_id || "?"} cwd=${cwd}`
);

try {
  const result = await buildArtifactPortal({
    projectRoot: cwd,
    preferProbe: true,
  });
  console.log(
    JSON.stringify({
      ok: result.ok,
      converged: result.converged,
      runner: result.benchmark.runner,
      source: result.benchmark.source,
      artifactPath: result.benchmark.artifactPath,
      portalIndexPath: result.portalIndexPath,
      convergedComponents: result.convergedComponents.map((c) => c.id),
      canvasId: result.canvasManifestId,
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
