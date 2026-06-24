/**
 * workflow/seed.ts — Read/write workflow baseline seeds (JSON5).
 */

import { join } from "path";
import { pathExists, readText, writeText } from "../bun-io.ts";
import { safeParse } from "../utils.ts";
import type { ScannerResult, WorkflowSeedState } from "./types.ts";

export function readSeed(path: string): WorkflowSeedState | null {
  if (!pathExists(path)) return null;
  const text = readText(path);
  const parsed = safeParse(text, null as WorkflowSeedState | null);
  if (!parsed || !Array.isArray(parsed.results)) return null;
  return parsed;
}

export async function writeSeedFile(
  path: string,
  domainId: string,
  results: ScannerResult[]
): Promise<void> {
  const payload: WorkflowSeedState = {
    domainId,
    generatedAt: new Date().toISOString(),
    results,
  };
  writeText(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function defaultSeedPath(projectRoot: string, domainId: string): string {
  return join(projectRoot, "seeds", `${domainId}.json5`);
}
