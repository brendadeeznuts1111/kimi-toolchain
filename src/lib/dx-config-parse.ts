/**
 * DX config load/parse — raw documents only, no domain typing.
 */

import { TOML } from "bun";
import { join } from "path";
import { pathExists } from "./bun-io.ts";
import { globalDxConfigPath } from "./paths.ts";
import { mergeDxConfigDocuments, type DxConfigDocument } from "./dx-config-merge.ts";

export const DEFAULT_DX_PROJECT_CONFIG_NAMES = [
  "dx.config.toml",
  ".dx/config.toml",
  ".config/dx.toml",
] as const;

export interface MergedDxConfigMeta {
  globalPath: string | null;
  projectPath: string | null;
  document: DxConfigDocument;
}

export class ConfigParseError extends Error {
  readonly _tag = "ConfigParseError" as const;
  constructor(
    readonly path: string,
    readonly cause: string
  ) {
    super(`Config parse error (${path}): ${cause}`);
    this.name = "ConfigParseError";
  }
}

/** First existing project config file under `projectRoot`. */
export function resolveProjectConfigPath(
  projectRoot: string,
  names: readonly string[] = DEFAULT_DX_PROJECT_CONFIG_NAMES
): string | null {
  for (const name of names) {
    const path = join(projectRoot, name);
    if (pathExists(path)) return path;
  }
  return null;
}

/** Parse a TOML file into a root table document. */
export async function readTomlDocument(path: string): Promise<DxConfigDocument> {
  let text: string;
  try {
    text = await Bun.file(path).text();
  } catch (err) {
    throw new ConfigParseError(path, err instanceof Error ? err.message : Bun.inspect(err));
  }

  try {
    const parsed = TOML.parse(text);
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ConfigParseError(path, "root must be a TOML table");
    }
    return parsed as DxConfigDocument;
  } catch (err) {
    if (err instanceof ConfigParseError) throw err;
    throw new ConfigParseError(path, err instanceof Error ? err.message : Bun.inspect(err));
  }
}

/** Load global + project TOML and merge into one raw document. */
export async function loadMergedConfigDocument(
  projectRoot: string,
  home?: string
): Promise<MergedDxConfigMeta> {
  const globalPath = globalDxConfigPath(home);
  const globalDoc = pathExists(globalPath) ? await readTomlDocument(globalPath) : {};
  const projectPath = resolveProjectConfigPath(projectRoot);
  const projectDoc = projectPath ? await readTomlDocument(projectPath) : {};

  return {
    globalPath: pathExists(globalPath) ? globalPath : null,
    projectPath,
    document: mergeDxConfigDocuments(globalDoc, projectDoc),
  };
}
