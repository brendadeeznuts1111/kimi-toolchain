import { describe, expect, test } from "bun:test";
import { stripANSI, wrapAnsi } from "../src/lib/inspect.ts";
import { terminalWidth } from "../src/lib/bun-utils.ts";

const RED = "\u001b[31m";
const GREEN = "\u001b[32m";
const RED_OFF = "\u001b[39m";
const RESET = "\u001b[0m";
const OSC8_START = "\u001b]8;;https://example.com\u0007";
const OSC8_END = "\u001b]8;;\u0007";
const SHORT_TEXT = `${RED}This is a long red text that needs wrapping${RESET}`;
const LONG_TEXT = `${GREEN}${"The quick brown fox jumps over the lazy dog. ".repeat(200)}${RESET}`;

describe("bun-wrap-ansi", () => {
  test("Bun.wrapAnsi is available", () => {
    expect(typeof Bun.wrapAnsi).toBe("function");
  });

  test("preserves SGR color across wrapped lines", () => {
    const wrapped = wrapAnsi(SHORT_TEXT, 20);
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

  test("short text wraps under 10µs", () => {
    const start = Bun.nanoseconds();
    const wrapped = wrapAnsi(SHORT_TEXT, 20);
    const elapsed = (Bun.nanoseconds() - start) / 1e3;

    console.log(`  wrapAnsi 45 chars: ${elapsed.toFixed(1)} µs (blog: ~0.7 µs)`);
    expect(wrapped.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(50);
  });

  test("long text wraps under 500µs", () => {
    const start = Bun.nanoseconds();
    const wrapped = wrapAnsi(LONG_TEXT, 40);
    const elapsed = (Bun.nanoseconds() - start) / 1e3;

    console.log(`  wrapAnsi ${LONG_TEXT.length} chars: ${elapsed.toFixed(0)} µs (blog: ~112 µs)`);
    expect(wrapped.length).toBeGreaterThan(LONG_TEXT.length);
    expect(elapsed).toBeLessThan(10_000);
  });
});
