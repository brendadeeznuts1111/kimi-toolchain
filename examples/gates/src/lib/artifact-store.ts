/**
 * Minimal artifact store — saves JSON envelopes for gate results.
 *
 * Artifacts land in `baseDir/<gate>/<timestamp>.json` with optional
 * lineage metadata. Compatible with `kimi-doctor --artifacts-lineage`.
 */

export interface ArtifactEnvelope {
  schemaVersion: number;
  gate: string;
  savedAt: string;
  size: number;
  metadata?: {
    level?: 1 | 2 | 3;
    hostname: string;
    pid: number;
    bunVersion: string;
  };
  payload: unknown;
}

export class ArtifactStore {
  constructor(private readonly baseDir: string) {}

  async save(gate: string, payload: unknown, level?: 1 | 2 | 3): Promise<string> {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const dir = `${this.baseDir}/${gate}`;
    await Bun.mkdir(dir, { recursive: true });

    const envelope: ArtifactEnvelope = {
      schemaVersion: 1,
      gate,
      savedAt: new Date().toISOString(),
      size: JSON.stringify(payload).length,
      metadata: {
        level,
        hostname: "localhost",
        pid: process.pid,
        bunVersion: Bun.version,
      },
      payload,
    };

    const path = `${dir}/${ts}.json`;
    await Bun.write(path, JSON.stringify(envelope, null, 2));
    return path;
  }

  async list(gate: string): Promise<string[]> {
    const dir = `${this.baseDir}/${gate}`;
    const files = await Array.fromAsync(new Bun.Glob("*.json").scan({ cwd: dir, absolute: false }));
    return files.sort();
  }

  async latest(gate: string): Promise<ArtifactEnvelope | null> {
    const files = await this.list(gate);
    if (files.length === 0) return null;
    const text = await Bun.file(`${this.baseDir}/${gate}/${files.at(-1)}`).text();
    try {
      return JSON.parse(text) as ArtifactEnvelope;
    } catch {
      return null;
    }
  }

  async count(gate: string): Promise<number> {
    return (await this.list(gate)).length;
  }
}
