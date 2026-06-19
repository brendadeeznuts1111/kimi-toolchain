import { join } from "path";
import { listDir, makeDir, pathExists } from "./bun-io.ts";
import { projectKimiDir } from "./paths.ts";
import { safeParse } from "./utils.ts";

export interface ArtifactRecord {
  path: string;
  relativePath: string;
  payload: unknown;
}

/** Persist gate run results under `{projectRoot}/.kimi/artifacts/{gateName}/`. */
export class ArtifactStore {
  constructor(private readonly projectRoot: string = process.cwd()) {}

  artifactsDir(gateName: string): string {
    return join(projectKimiDir(this.projectRoot), "artifacts", gateName);
  }

  /** Write JSON artifact; returns absolute path. */
  async save(gateName: string, payload: unknown): Promise<string> {
    const dir = this.artifactsDir(gateName);
    makeDir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const path = join(dir, `${stamp}.json`);
    await Bun.write(path, JSON.stringify(payload, null, 2));
    return path;
  }

  /** List artifact relative paths for a gate, oldest → newest. */
  async list(gateName: string): Promise<string[]> {
    const dir = this.artifactsDir(gateName);
    if (!pathExists(dir)) return [];
    return listDir(dir)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => this.relativePath(join(dir, name)));
  }

  /** Newest artifact for a gate, or null when the directory is empty. */
  async getLatest(gateName: string): Promise<ArtifactRecord | null> {
    const dir = this.artifactsDir(gateName);
    if (!pathExists(dir)) return null;
    const names = listDir(dir)
      .filter((name) => name.endsWith(".json"))
      .sort();
    const latest = names.at(-1);
    if (!latest) return null;
    const path = join(dir, latest);
    const text = await Bun.file(path).text();
    return {
      path,
      relativePath: this.relativePath(path),
      payload: safeParse(text, null),
    };
  }

  /** Path relative to project root for CLI display. */
  relativePath(absolutePath: string): string {
    const root = this.projectRoot.endsWith("/") ? this.projectRoot : `${this.projectRoot}/`;
    if (absolutePath.startsWith(root)) {
      return absolutePath.slice(root.length);
    }
    return absolutePath;
  }
}
