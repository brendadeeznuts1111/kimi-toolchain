/**
 * workflow/seed.ts — Read/write workflow baseline seeds (JSON5).
 *
 * Reads prefer JSON5 (Bun.JSON5.parse) when available (Bun ≥1.3.7), falling back to JSON.
 * Writes use Bun.JSON5.stringify on ≥1.3.7, falling back to JSON.stringify.
 * Valid JSON is valid JSON5, so the fallback is always correct.
 */

import { join } from "path";
import { pathExists, readText, writeText } from "../bun-io.ts";
import { safeJson5, safeParse } from "../safe-parse.ts";
import type { ScannerResult, WorkflowSeedState } from "./types.ts";

const JSON5_READY = typeof (Bun as Record<string, unknown>).JSON5 === "object";

/** JSON5-aware parse — JSON5 when available, else plain JSON. */
function json5Parse<T>(text: string, fallback: T): T {
  return JSON5_READY ? safeJson5(text, fallback) : safeParse(text, fallback);
}

/** JSON5 stringify — Bun.JSON5 when available, else plain JSON. */
function json5Stringify(payload: unknown): string {
  if (JSON5_READY) {
    return (Bun as { JSON5: { stringify(v: unknown): string } }).JSON5.stringify(payload);
  }
  return JSON.stringify(payload, null, 2);
}

export function readSeed(path: string): WorkflowSeedState | null {
  if (!pathExists(path)) return null;
  const text = readText(path);
  const parsed = json5Parse(text, null as WorkflowSeedState | null);
  if (!parsed || !Array.isArray(parsed.results)) return null;
  return parsed;
}

export function writeSeedFile(path: string, domainId: string, results: ScannerResult[]): void {
  if (!domainId) throw new Error("domainId is required");
  if (!Array.isArray(results)) throw new Error("results must be an array");
  const payload: WorkflowSeedState = {
    domainId,
    generatedAt: new Date().toISOString(),
    results,
  };
  writeText(path, `${json5Stringify(payload)}\n`, "utf8");
}

export function defaultSeedPath(projectRoot: string, domainId: string): string {
  return join(projectRoot, "seeds", `${domainId}.json5`);
}
