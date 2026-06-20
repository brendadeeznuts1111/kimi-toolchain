/**
 * Bun.wrapAnsi regression coverage.
 *
 * Bun v1.3.7 added a native ANSI-aware text wrapper that preserves SGR colors,
 * OSC 8 hyperlinks, Unicode display widths, and normalizes CRLF newlines.
 *
 * @see https://bun.com/blog/bun-v1.3.7#bun-wrapansi-for-ansi-aware-text-wrapping
 */
import { describe, expect, test } from "bun:test";
import { stripANSI, wrapAnsi } from "../src/lib/inspect.ts";
import { terminalWidth } from "../src/lib/bun-utils.ts";

const RED = "\u001b[31m";
const RED_OFF = "\u001b[39m";
const RESET = "\u001b[0m";
const OSC8_START = "\u001b]8;;https://example.com\u0007";
const OSC8_END = "\u001b]8;;\u0007";

describe("wrap-ansi", () => {
  test("preserves SGR color across wrapped lines", () => {
    const text = `${RED}This is a long red text that needs wrapping${RESET}`;
    const wrapped = wrapAnsi(text, 20);
    const lines = wrapped.split("\n");

    expect(lines).toHaveLength(3);
    expect(stripANSI(wrapped)).toBe("This is a long red\ntext that needs\nwrapping");
    expect(lines[0]).toBe(`${RED}This is a long red${RED_OFF}`);
    expect(lines[1]).toBe(`${RED}text that needs${RED_OFF}`);
    expect(lines[2]).toBe(`${RED}wrapping${RESET}`);
    expect(lines.every((line) => terminalWidth(line) <= 20)).toBe(true);
  });

  test("preserves OSC 8 hyperlinks across wrapped lines", () => {
    const wrapped = wrapAnsi(`${OSC8_START}Example hyperlink text${OSC8_END}`, 10);

    expect(stripANSI(wrapped)).toBe("Example\nhyperlink\ntext");
    for (const line of wrapped.split("\n")) {
      expect(line.startsWith(OSC8_START)).toBe(true);
      expect(line.endsWith(OSC8_END)).toBe(true);
      expect(terminalWidth(line)).toBeLessThanOrEqual(10);
    }
  });

  test("hard option breaks long words that default wrapping keeps intact", () => {
    const word = `${RED}supercalifragilistic${RESET}`;

    expect(wrapAnsi(word, 8)).toBe(word);
    expect(stripANSI(wrapAnsi(word, 8, { hard: true }))).toBe("supercal\nifragili\nstic");
  });

  test("wraps by Unicode display width and normalizes CRLF newlines", () => {
    const wide = wrapAnsi("你好世界 hello", 6);
    const crlf = wrapAnsi("alpha\r\nbeta gamma", 8);

    expect(wide).toBe("你好世界\nhello");
    expect(wide.split("\n").every((line) => terminalWidth(line) <= 8)).toBe(true);
    expect(crlf).toBe("alpha\nbeta\ngamma");
    expect(crlf).not.toContain("\r");
  });
});
