/**
 * Bun-native NDJSON append/read helpers for project-local ledgers.
 */

import { appendFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { safeParse } from "./utils.ts";

export async function appendNdjsonRecord<T extends object>(path: string, record: T): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`);
}

export async function readNdjsonFile<T>(
  path: string,
  validator?: (value: unknown) => value is T
): Promise<T[]> {
  if (!existsSync(path)) return [];
  const text = await Bun.file(path).text();
  return parseNdjsonText(text, validator);
}

export function parseNdjsonText<T>(text: string, validator?: (value: unknown) => value is T): T[] {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (typeof Bun.JSONL?.parse === "function") {
    try {
      const parsed = Bun.JSONL.parse(text) as unknown[];
      if (validator) return parsed.filter(validator);
      return parsed as T[];
    } catch {
      // fall through
    }
  }

  const out: T[] = [];
  for (const line of lines) {
    const parsed = safeParse<unknown | null>(line, null);
    if (parsed === null) continue;
    if (validator && !validator(parsed)) continue;
    out.push(parsed as T);
  }
  return out;
}

export async function* streamNdjsonFile<T>(
  path: string,
  validator?: (value: unknown) => value is T
): AsyncGenerator<T> {
  if (!existsSync(path)) return;
  const text = await Bun.file(path).text();
  for (const record of parseNdjsonText<T>(text, validator)) {
    yield record;
  }
}

export async function rewriteNdjsonFile<T extends object>(
  path: string,
  records: T[]
): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });
  const body = records.map((record) => JSON.stringify(record)).join("\n");
  await Bun.write(path, body.length > 0 ? `${body}\n` : "");
}
