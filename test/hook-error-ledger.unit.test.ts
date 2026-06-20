/**
 * Hook-internal error ledger regression tests.
 */
import { describe, expect, test } from "bun:test";
import { join } from "path";
import { appendHookError } from "../src/lib/hook-error-ledger.ts";
import { testTempDir } from "./helpers.ts";

describe("hook-error-ledger", () => {
  test("appendHookError writes a structured record to the ledger", async () => {
    const dir = testTempDir("hook-error-ledger");
    const path = join(dir, "hook-errors.jsonl");
    const err = new Error("taxonomy load failed");

    const record = await appendHookError(err, { path });

    expect(record.schemaVersion).toBe(1);
    expect(record.tool).toBe("log-tool-failure");
    expect(record.level).toBe("error");
    expect(record.message).toBe("taxonomy load failed");
    expect(record.stack).toContain("taxonomy load failed");
    expect(record.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const text = await Bun.file(path).text();
    const lines = text.trim().split("\n");
    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.message).toBe("taxonomy load failed");
    expect(parsed.tool).toBe("log-tool-failure");
  });

  test("appendHookError handles non-Error values", async () => {
    const dir = testTempDir("hook-error-ledger-string");
    const path = join(dir, "hook-errors.jsonl");

    const record = await appendHookError("plain string error", { path });

    expect(record.message).toBe("plain string error");
    const text = await Bun.file(path).text();
    expect(JSON.parse(text.trim()).message).toBe("plain string error");
  });
});
