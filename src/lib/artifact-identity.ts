/**
 * Artifact identity resolution — session, workspace, pane, and run correlation.
 *
 * @see src/lib/artifact-store.ts — envelope persistence
 * @see src/gates/runner.ts — gate-runner runId propagation
 */
import {
  artifactIdentityEnv,
  generateRunId,
  resolveArtifactSessionContext,
  type ArtifactIdentityEnvInput,
  type ArtifactSessionContext,
} from "./artifact-store.ts";

export { artifactIdentityEnv, generateRunId, resolveArtifactSessionContext };
export type { ArtifactIdentityEnvInput };

/** Full identity chain for artifact correlation; always includes a `runId`. */
export function resolveIdentityContext(options?: {
  /** Prefer this run id over `KIMI_RUN_ID` / generated default. */
  runId?: string;
}): ArtifactSessionContext & { runId: string } {
  const base = resolveArtifactSessionContext();
  const runId = options?.runId?.trim() || base.runId || generateRunId();
  return { ...base, runId };
}

/** Shell `export` prefix for `herdr pane run` — propagates identity into pane commands. */
export function buildPaneIdentityExports(paneId: string): string {
  const env = artifactIdentityEnv({ paneId: paneId.trim() });
  return Object.entries(env)
    .map(([key, value]) => `export ${key}="${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
    .join("; ");
}
