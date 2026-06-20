/**
 * Artifact Portal manifest types — shared by lib runtime and scaffold template.
 */

import {
  PORTAL_HERDR_ACTION,
  PORTAL_HERDR_PLUGIN_ID,
  type ConvergedComponentRecord,
} from "./benchmark-convergence.ts";

export const ARTIFACT_PORTAL_TEMPLATE_VERSION = 1;
export const PORTAL_MANIFEST_TYPE = "portal-manifest";

export {
  CONVERGED_PORTAL_COMPONENTS,
  PORTAL_HERDR_ACTION,
  PORTAL_HERDR_PLUGIN_ID,
} from "./benchmark-convergence.ts";

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
  configStatus?: {
    type: string;
    source: "serve-probe" | "local-loop";
    probeUrl?: string;
    artifactPath: string;
    aligned: boolean;
  };
  herdr: {
    pluginId: string;
    action: string;
  };
  benchmarkArtifactPath: string;
  convergedComponents: ConvergedComponentRecord[];
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
  convergedComponents: ConvergedComponentRecord[];
  configStatus?: ArtifactPortalManifestPayload["configStatus"];
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
    ...(input.configStatus ? { configStatus: input.configStatus } : {}),
    herdr: {
      pluginId: PORTAL_HERDR_PLUGIN_ID,
      action: PORTAL_HERDR_ACTION,
    },
    benchmarkArtifactPath: input.benchmarkArtifactPath,
    convergedComponents: input.convergedComponents,
  };
}
