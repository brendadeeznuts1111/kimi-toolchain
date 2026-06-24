import { describe, expect, test } from "bun:test";
import {
  buildLogPreviewLine,
  formatLogPreviewText,
  LOG_PREVIEW_MAX_COLS,
} from "../src/lib/log-preview.ts";
import { stripANSI } from "../src/lib/inspect.ts";

describe("log-preview", () => {
  test("formatLogPreviewText strips ANSI before width truncation", () => {
    const hyperlink = "\u001b]8;;https://example.com/agent\u0007link\u001b]8;;\u0007";
    const colored = `\u001b[31m${hyperlink}\u001b[0m`;
    const preview = formatLogPreviewText(colored, 40);
    expect(preview).not.toContain("\u001b");
    expect(stripANSI(preview)).toBe(preview);
    expect(Bun.stringWidth(preview)).toBeLessThanOrEqual(40);
  });

  test("formatLogPreviewText truncates by display width not code units", () => {
    const wide = "你好世界你好世界你好世界";
    const preview = formatLogPreviewText(wide, 8);
    expect(preview.endsWith("…")).toBe(true);
    expect(Bun.stringWidth(preview)).toBeLessThan(Bun.stringWidth(wide));
  });

  test("buildLogPreviewLine keeps raw scrollback intact", () => {
    const raw = `\u001b[32mok\u001b[0m ${"x".repeat(LOG_PREVIEW_MAX_COLS + 20)}`;
    const row = buildLogPreviewLine(raw, LOG_PREVIEW_MAX_COLS);
    expect(row.raw).toBe(raw);
    expect(row.preview.length).toBeLessThan(raw.length);
    expect(Bun.stringWidth(row.preview)).toBeLessThanOrEqual(LOG_PREVIEW_MAX_COLS);
  });
});
