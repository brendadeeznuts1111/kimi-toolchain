import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveContextFilePath, writeContextDrop } from "../src/lib/herdr-project-context.ts";

describe("herdr-project-context", () => {
  const previous = process.env.HERDR_CONTEXT_FILE;

  afterEach(() => {
    if (previous === undefined) delete process.env.HERDR_CONTEXT_FILE;
    else process.env.HERDR_CONTEXT_FILE = previous;
  });

  test("resolveContextFilePath defaults to /tmp/workspace-context.md", () => {
    delete process.env.HERDR_CONTEXT_FILE;
    expect(resolveContextFilePath()).toBe("/tmp/workspace-context.md");
  });

  test("resolveContextFilePath respects HERDR_CONTEXT_FILE", () => {
    process.env.HERDR_CONTEXT_FILE = "/tmp/custom-context.md";
    expect(resolveContextFilePath()).toBe("/tmp/custom-context.md");
  });

  test("writeContextDrop writes markdown context to configured path", () => {
    const path = join(tmpdir(), `workspace-context-${Bun.randomUUIDv7()}.md`);
    process.env.HERDR_CONTEXT_FILE = path;
    const text = "# Workspace context\n\nBranch: main";
    expect(writeContextDrop(text)).toBe(path);
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(text);
    rmSync(path, { force: true });
  });
});
