/**
 * Log preview formatting for dashboard widgets — ANSI- and width-aware column truncation.
 *
 * WebView cards strip escapes for display but keep `raw` for copy/tail sync.
 * Uses Bun.stripANSI + Bun.stringWidth (SIMD) via inspect/bun-utils helpers.
 */

import { sliceAnsi, stripANSI } from "./inspect.ts";

/** Default terminal column budget for log preview cards (~960px panel). */
export const LOG_PREVIEW_MAX_COLS = 120;

export interface LogPreviewLine {
  raw: string;
  preview: string;
  displayWidth: number;
}

/** Plain-text preview column: strip escapes, then truncate by display width. */
export function formatLogPreviewText(text: string, maxCols = LOG_PREVIEW_MAX_COLS): string {
  const plain = stripANSI(text);
  if (Bun.stringWidth(plain) <= maxCols) return plain;
  return sliceAnsi(plain, 0, maxCols, "…");
}

/** Build a preview row preserving the full scrollback line. */
export function buildLogPreviewLine(raw: string, maxCols = LOG_PREVIEW_MAX_COLS): LogPreviewLine {
  return {
    raw,
    preview: formatLogPreviewText(raw, maxCols),
    displayWidth: Bun.stringWidth(raw),
  };
}

/** Map scrollback lines to preview entries for dashboard APIs. */
export function buildLogPreviewLines(
  lines: string[],
  maxCols = LOG_PREVIEW_MAX_COLS
): LogPreviewLine[] {
  return lines.map((line) => buildLogPreviewLine(line, maxCols));
}
