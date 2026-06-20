/**
 * Artifact Portal scaffold — manifest snapshot for portal publish builds.
 */

export const ARTIFACT_PORTAL_TEMPLATE_VERSION = 1;
export const PORTAL_MANIFEST_TYPE = "portal-manifest";
export const PORTAL_HERDR_PLUGIN_ID = "dev.kimi-toolchain";
export const PORTAL_HERDR_ACTION = "benchmark-portal";

export interface ArtifactPortalManifestPayload {
  schemaVersion: number;
  kind: "artifact-portal-manifest";
  builtAt: string;
  contract: string;
  canvas: {
    manifestId: string;
    companion: string;
    manifest: string;
  };
  diagnostics: {
    type: string;
    source: "serve-probe" | "local-loop";
    probeUrl?: string;
    runner: string;
  };
  herdr: {
    pluginId: string;
    action: string;
  };
  benchmarkArtifactPath: string;
}

export function buildPortalManifestPayload(input: {
  builtAt: string;
  contract: string;
  canvasManifestId: string;
  diagnosticsType: string;
  source: "serve-probe" | "local-loop";
  runner: string;
  benchmarkArtifactPath: string;
  probeUrl?: string;
}): ArtifactPortalManifestPayload {
  return {
    schemaVersion: ARTIFACT_PORTAL_TEMPLATE_VERSION,
    kind: "artifact-portal-manifest",
    builtAt: input.builtAt,
    contract: input.contract,
    canvas: {
      manifestId: input.canvasManifestId,
      companion: "docs/canvases/benchmark.canvas.tsx",
      manifest: "src/canvases/benchmark.manifest.ts",
    },
    diagnostics: {
      type: input.diagnosticsType,
      source: input.source,
      runner: input.runner,
      ...(input.probeUrl ? { probeUrl: input.probeUrl } : {}),
    },
    herdr: {
      pluginId: PORTAL_HERDR_PLUGIN_ID,
      action: PORTAL_HERDR_ACTION,
    },
    benchmarkArtifactPath: input.benchmarkArtifactPath,
  };
}