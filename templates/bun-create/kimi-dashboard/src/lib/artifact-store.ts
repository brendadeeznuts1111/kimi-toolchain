/**
 * Minimal artifact store — saves JSON envelopes for gate results and lineage.
 *
 * Usage:
 *   import { saveArtifact } from "./lib/artifact-store.ts";
 *   await saveArtifact("var/artifacts", "health", { ...envelope });
 */

export interface ArtifactEnvelope {
  tool: string;
  level: "info" | "warn" | "error";
  timestamp: string;
  metadata?: {
    lineage?: string[];
    runId?: string;
  };
  payload: unknown;
}

export async function saveArtifact(
  dir: string,
  gate: string,
  envelope: ArtifactEnvelope
): Promise<string> {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const path = `${dir}/${gate}/${ts}.json`;
  await Bun.mkdir(`${dir}/${gate}`, { recursive: true });
  await Bun.write(path, JSON.stringify(envelope, null, 2));
  return path;
}

export async function listArtifacts(dir: string, gate: string): Promise<string[]> {
  const gateDir = `${dir}/${gate}`;
  const files = await Array.fromAsync(
    new Bun.Glob("*.json").scan({ cwd: gateDir, absolute: false })
  );
  return files.sort();
}

export async function latestArtifact(dir: string, gate: string): Promise<ArtifactEnvelope | null> {
  const files = await listArtifacts(dir, gate);
  if (files.length === 0) return null;
  const latest = await Bun.file(`${dir}/${gate}/${files.at(-1)}`).text();
  try {
    return JSON.parse(latest) as ArtifactEnvelope;
  } catch {
    return null;
  }
}
