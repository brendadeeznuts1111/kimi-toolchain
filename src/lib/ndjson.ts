/**
 * Bun-native NDJSON (JSONL) helpers.
 *
 * @see https://bun.com/docs/runtime/jsonl
 *
 * - `readNdjsonFile` — full-file `parseChunk` drain with error recovery
 * - `streamNdjsonRecords` — `file.stream()` + `Bun.JSONL.parseChunk` (lazy)
 * - `appendNdjsonRecord` — `Bun.write(..., { create: true, append: true })` when supported
 */

import { appendFileSync, existsSync, mkdirSync, unlinkSync } from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";

type BunWriteAppendOptions = {
  create?: boolean;
  createPath?: boolean;
  append?: boolean;
};

const WRITE_APPEND: BunWriteAppendOptions = { create: true, append: true };
const WRITE_CREATE: BunWriteAppendOptions = { create: true, append: false };
type AppendMode = "bun-write" | "fs-append";
let appendMode: AppendMode | null = null;

async function bunWrite(
  path: string,
  data: string,
  options?: BunWriteAppendOptions
): Promise<void> {
  await Bun.write(path, data, options as Parameters<typeof Bun.write>[2]);
}

/** Read all JSONL records using Bun.JSONL.parseChunk with error recovery. */
export async function readNdjsonFile<T = unknown>(path: string): Promise<T[]> {
  if (!existsSync(path)) return [];
  const bytes = await Bun.file(path).bytes();
  if (bytes.length === 0) return [];

  const records: T[] = [];
  let buffer: Uint8Array<ArrayBufferLike> = bytes;
  while (buffer.length > 0) {
    const parsed = drainParseChunk(buffer);
    records.push(...(parsed.values as T[]));
    buffer = parsed.buffer;
    if (parsed.stalled) break;
  }
  return records;
}

/**
 * Lazily iterate JSONL records using the binary streaming pattern from Bun docs.
 * @see https://bun.com/docs/runtime/jsonl#byte-offsets-with-uint8array
 */
export async function* streamNdjsonRecords<T = unknown>(
  path: string
): AsyncGenerator<{ value: T; index: number }> {
  if (!existsSync(path)) return;

  let buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  let index = 0;

  for await (const chunk of Bun.file(path).stream()) {
    buffer = appendChunk(buffer, chunk);
    const parsed = drainParseChunk(buffer);
    buffer = parsed.buffer;
    for (const value of parsed.values) {
      yield { value: value as T, index: index++ };
    }
  }

  while (buffer.length > 0) {
    const parsed = drainParseChunk(buffer);
    buffer = parsed.buffer;
    for (const value of parsed.values) {
      yield { value: value as T, index: index++ };
    }
    if (parsed.stalled) break;
  }
}

/**
 * Append one JSONL record.
 *
 * Prefers idiomatic Bun append:
 * `await Bun.write(path, JSON.stringify(entry) + '\\n', { create: true, append: true })`
 *
 * Bun 1.3.14 truncates on append — we probe once and fall back to `appendFileSync`.
 */
export async function appendNdjsonRecord(path: string, record: unknown): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });
  const line = `${JSON.stringify(record)}\n`;
  if ((await resolveAppendMode()) === "bun-write") {
    await bunWrite(path, line, WRITE_APPEND);
    return;
  }
  appendFileSync(path, line);
}

/** Rewrite a JSONL file from an array of records. */
export async function writeNdjsonFile(path: string, records: unknown[]): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });
  const body =
    records.length > 0 ? records.map((record) => JSON.stringify(record)).join("\n") + "\n" : "";
  await Bun.write(path, body);
}

async function resolveAppendMode(): Promise<AppendMode> {
  if (appendMode) return appendMode;

  const probe = join(
    tmpdir(),
    `kimi-bun-append-${Bun.hash(String(process.pid)).toString(16)}.jsonl`
  );
  try {
    await bunWrite(probe, "a\n", WRITE_CREATE);
    await bunWrite(probe, "b\n", WRITE_APPEND);
    appendMode = (await Bun.file(probe).text()) === "a\nb\n" ? "bun-write" : "fs-append";
  } catch {
    appendMode = "fs-append";
  } finally {
    try {
      unlinkSync(probe);
    } catch {
      // ignore probe cleanup failures
    }
  }
  return appendMode;
}

function appendChunk(
  buffer: Uint8Array<ArrayBufferLike>,
  chunk: Uint8Array<ArrayBufferLike>
): Uint8Array<ArrayBufferLike> {
  const normalized = new Uint8Array(chunk);
  const next = new Uint8Array(buffer.length + normalized.length);
  next.set(buffer);
  next.set(normalized, buffer.length);
  return next;
}

interface ParseChunkDrain {
  buffer: Uint8Array<ArrayBufferLike>;
  values: unknown[];
  stalled: boolean;
}

/** Parse complete values from buffer; on error skip to next newline per Bun docs. */
function drainParseChunk(buffer: Uint8Array<ArrayBufferLike>): ParseChunkDrain {
  const values: unknown[] = [];
  let remaining = buffer;

  while (remaining.length > 0) {
    const result = Bun.JSONL.parseChunk(remaining);
    values.push(...result.values);
    remaining = remaining.subarray(result.read);

    if (result.done) {
      const tail = result.read > 0 ? remaining : new Uint8Array(0);
      return { buffer: tail, values, stalled: false };
    }

    if (result.error === null) {
      if (result.read === 0) {
        return { buffer: remaining, values, stalled: true };
      }
      continue;
    }

    const newline = remaining.indexOf("\n".charCodeAt(0));
    if (newline < 0) {
      return { buffer: remaining, values, stalled: true };
    }
    remaining = remaining.subarray(newline + 1);
  }

  return { buffer: remaining, values, stalled: false };
}

/** @internal Test hook to reset cached append mode. */
export function resetAppendModeCacheForTests(): void {
  appendMode = null;
}
