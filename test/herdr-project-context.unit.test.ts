import { describe, expect, test } from "bun:test";
import { join } from "path";
import { resolveContextFilePath, writeContextDrop } from "../src/lib/herdr-project-context.ts";
import { cleanupPath, testTempDir, withClearedEnv, withEnv } from "./helpers.ts";
import { pathExists, readText } from "../src/lib/bun-io.ts";

const CONTEXT_KEY = ["HERDR_CONTEXT_FILE"] as const;

describe("herdr-project-context", () => {
  test("resolveContextFilePath defaults to /tmp/workspace-context.md", () => {
    withClearedEnv(CONTEXT_KEY, () => {
      expect(resolveContextFilePath()).toBe("/tmp/workspace-context.md");
    });
  });

  test("resolveContextFilePath respects HERDR_CONTEXT_FILE", () => {
    withEnv({ HERDR_CONTEXT_FILE: "/tmp/custom-context.md" }, () => {
      expect(resolveContextFilePath()).toBe("/tmp/custom-context.md");
    });
  });

  test("writeContextDrop writes markdown context to configured path", () => {
    const dir = testTempDir("workspace-context-");
    const path = join(dir, "context.md");
    withEnv({ HERDR_CONTEXT_FILE: path }, () => {
      const text = "# Workspace context\n\nBranch: main";
      expect(writeContextDrop(text)).toBe(path);
      expect(pathExists(path)).toBe(true);
      expect(readText(path)).toBe(text);
    });
    cleanupPath(dir);
  });
});
