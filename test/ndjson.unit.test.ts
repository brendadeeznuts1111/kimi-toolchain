import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  appendNdjsonRecord,
  appendNdjsonRecordSync,
  formatNdjsonLine,
  readNdjsonFile,
  streamNdjsonRecords,
  writeNdjsonFile,
  writeStdoutNdjsonLineSync,
} from "../src/lib/ndjson.ts";
import { captureStdout } from "./helpers.ts";

function tempDir(): string {
  const dir = join(tmpdir(), `kimi-ndjson-${Bun.randomUUIDv7()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("ndjson", () => {
  test("readNdjsonFile parses records with Bun.JSONL", async () => {
    const dir = tempDir();
    try {
      const path = join(dir, "ledger.jsonl");
      await writeNdjsonFile(path, [{ a: 1 }, { b: 2 }]);
      const records = await readNdjsonFile<{ a?: number; b?: number }>(path);
      expect(records).toEqual([{ a: 1 }, { b: 2 }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("appendNdjsonRecord appends without truncating prior lines", async () => {
    const dir = tempDir();
    try {
      const path = join(dir, "ledger.jsonl");
      await appendNdjsonRecord(path, { a: 1 });
      await appendNdjsonRecord(path, { b: 2 });
      const records = await readNdjsonFile(path);
      expect(records).toEqual([{ a: 1 }, { b: 2 }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("streamNdjsonRecords lazily yields parsed values", async () => {
    const dir = tempDir();
    try {
      const path = join(dir, "ledger.jsonl");
      await writeNdjsonFile(path, [{ id: 1 }, { id: 2 }, { id: 3 }]);
      const ids: number[] = [];
      for await (const { value, index } of streamNdjsonRecords<{ id: number }>(path)) {
        expect(index).toBe(ids.length);
        ids.push(value.id);
      }
      expect(ids).toEqual([1, 2, 3]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("streamNdjsonRecords recovers from invalid mid-file lines", async () => {
    const dir = tempDir();
    try {
      const path = join(dir, "ledger.jsonl");
      await Bun.write(
        path,
        `${JSON.stringify({ id: 1 })}\nnot-json\n${JSON.stringify({ id: 2 })}\n`
      );
      const ids: number[] = [];
      for await (const { value } of streamNdjsonRecords<{ id: number }>(path)) {
        ids.push(value.id);
      }
      expect(ids).toEqual([1, 2]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("formatNdjsonLine serializes one trailing newline", () => {
    expect(formatNdjsonLine({ a: 1 })).toBe('{"a":1}\n');
  });

  test("writeStdoutNdjsonLineSync writes raw NDJSON to stdout", () => {
    const capture = captureStdout();
    try {
      writeStdoutNdjsonLineSync({ ok: true });
      expect(capture.lines.join("")).toBe('{"ok":true}\n');
    } finally {
      capture.restore();
    }
  });

  test("appendNdjsonRecordSync appends without truncating", async () => {
    const dir = tempDir();
    try {
      const path = join(dir, "ledger.jsonl");
      appendNdjsonRecordSync(path, { a: 1 });
      appendNdjsonRecordSync(path, { b: 2 });
      const text = await Bun.file(path).text();
      expect(text).toBe('{"a":1}\n{"b":2}\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("readNdjsonFile recovers records after invalid mid-file lines", async () => {
    const dir = tempDir();
    try {
      const path = join(dir, "ledger.jsonl");
      await Bun.write(
        path,
        `${JSON.stringify({ id: 1 })}\nnot-json\n${JSON.stringify({ id: 2 })}\n`
      );
      const records = await readNdjsonFile<{ id: number }>(path);
      expect(records.map((record) => record.id)).toEqual([1, 2]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
