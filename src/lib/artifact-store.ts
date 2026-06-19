import { join } from "path";
import { makeDir } from "./bun-io.ts";
import { projectKimiDir } from "./paths.ts";

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

  /** Path relative to project root for CLI display. */
  relativePath(absolutePath: string): string {
    const root = this.projectRoot.endsWith("/") ? this.projectRoot : `${this.projectRoot}/`;
    if (absolutePath.startsWith(root)) {
      return absolutePath.slice(root.length);
    }
    return absolutePath;
  }
}
