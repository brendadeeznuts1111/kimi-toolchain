/**
 * Bun-native NDJSON (JSONL) helpers.
 *
 * @see https://bun.com/docs/runtime/jsonl
 *
 * - `readNdjsonFile` — full-file `parseChunk` drain with error recovery
 * - `streamNdjsonRecords` — `file.stream()` + `Bun.JSONL.parseChunk` (lazy)
 * - `appendNdjsonRecord` — `Bun.write` with append mode (probed at first call)
 */

import { appendText, makeDir } from "./bun-io.ts";
import { dirname, join } from "path";
import { safeParse } from "./safe-parse.ts";

/** Serialize one JSONL/NDJSON record (includes trailing newline). */
export function formatNdjsonLine(record: unknown): string {
  return `${JSON.stringify(record)}\n`;
}

/** Write one NDJSON line to stdout without `console.log` formatting. */
export function writeStdoutNdjsonLineSync(record: unknown): void {
  process.stdout.write(formatNdjsonLine(record));
}

/** Write pretty-printed JSON to stdout (multi-line document + trailing newline). */
export function writeStdoutJsonSync(value: unknown, indent: number | null = 2): void {
  const body = indent == null ? JSON.stringify(value) : JSON.stringify(value, null, indent);
  process.stdout.write(`${body}\n`);
}

/** Sync append for hot paths — uses appendText (Node appendFileSync). */
export function appendNdjsonRecordSync(path: string, record: unknown): void {
  makeDir(dirname(path), { recursive: true });
  appendText(path, formatNdjsonLine(record));
}

/** Parse newline-delimited JSON text into validated records. */
export function parseNdjsonText<T>(text: string, validator?: (value: unknown) => value is T): T[] {
  if (typeof Bun.JSONL?.parse === "function") {
    try {
      const parsed = Bun.JSONL.parse(text) as unknown[];
      const expectedLines = text.split("\n").filter((l) => l.trim().length > 0).length;
      if (parsed.length === expectedLines) {
        if (validator) return parsed.filter(validator);
        return parsed as T[];
      }
      // Bun.JSONL.parse returns partial results on error (doesn't throw).
      // Fall through to parseChunkStringDrain for full error recovery.
    } catch {
      // fall through to parseChunk with string offsets (v1.3.11 fix)
    }
  }

  if (typeof Bun.JSONL?.parseChunk === "function") {
    return parseChunkStringDrain<T>(text, validator);
  }

  const out: T[] = [];
  for (const line of text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)) {
    const parsed = safeParse<unknown | null>(line, null);
    if (parsed === null) continue;
    if (validator && !validator(parsed)) continue;
    out.push(parsed as T);
  }
  return out;
}

/** Drain complete values from a string using Bun.JSONL.parseChunk with start/end offsets. */
function parseChunkStringDrain<T>(text: string, validator?: (value: unknown) => value is T): T[] {
  const out: T[] = [];
  let start = 0;

  while (start < text.length) {
    const result = Bun.JSONL.parseChunk(text, start);
    out.push(...(result.values as T[]));
    start += result.read;

    if (result.done) break;

    if (result.error !== null) {
      const newlineIdx = text.indexOf("\n", start);
      if (newlineIdx < 0) break;
      start = newlineIdx + 1;
      continue;
    }

    if (result.read === 0) break;
  }

  if (validator) return out.filter(validator);
  return out;
}

/** Read all JSONL records using Bun.JSONL.parseChunk with error recovery. */
export async function readNdjsonFile<T = unknown>(path: string): Promise<T[]> {
  if (!(await Bun.file(path).exists())) return [];
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
  if (!(await Bun.file(path).exists())) return;

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

/** Append one JSONL record — probes Bun.write append mode at first call. */
let _appendProbed = false;
let _bunAppendWorks = false;

export async function appendNdjsonRecord(path: string, record: unknown): Promise<void> {
  if (!_appendProbed) await probeBunAppend();
  makeDir(dirname(path), { recursive: true });
  const line = formatNdjsonLine(record);
  if (_bunAppendWorks) {
    await Bun.write(path, line, { create: true, append: true } as Parameters<typeof Bun.write>[2]);
  } else {
    appendText(path, line);
  }
}

async function probeBunAppend(): Promise<void> {
  _appendProbed = true;
  const tmpBase = Bun.env.TMPDIR ?? "/tmp";
  const tmp = join(tmpBase, `.kimi-append-${Bun.hash(String(process.pid)).toString(16)}.tmp`);
  try {
    await Bun.write(tmp, "a\n", { create: true } as Parameters<typeof Bun.write>[2]);
    await Bun.write(tmp, "b\n", { create: true, append: true } as Parameters<typeof Bun.write>[2]);
    _bunAppendWorks = (await Bun.file(tmp).text()) === "a\nb\n";
  } catch {
    _bunAppendWorks = false;
  } finally {
    try {
      await Bun.file(tmp).delete();
    } catch {}
  }
}

// Re-export for tests
export function resetAppendCache(): void {
  _appendProbed = false;
  _bunAppendWorks = false;
}

/** Rewrite a JSONL file from an array of records. */
export async function writeNdjsonFile(path: string, records: unknown[]): Promise<void> {
  makeDir(dirname(path), { recursive: true });
  const body =
    records.length > 0 ? records.map((record) => JSON.stringify(record)).join("\n") + "\n" : "";
  await Bun.write(path, body);
}

/** Alias for callers that emphasize full-file replacement. */
export const rewriteNdjsonFile = writeNdjsonFile;

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
