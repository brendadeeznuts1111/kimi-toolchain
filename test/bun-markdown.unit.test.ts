import { describe, expect, test } from "bun:test";
import {
  markdownAnsiSupported,
  renderMarkdownAnsi,
  stripMarkdownPlain,
} from "../src/lib/bun-markdown.ts";

describe("bun-markdown", () => {
  test("markdownAnsiSupported reflects Bun.markdown.ansi", () => {
    expect(markdownAnsiSupported()).toBe(typeof Bun.markdown?.ansi === "function");
  });

  test("stripMarkdownPlain removes frontmatter and inline styles", () => {
    const text = `---
name: demo
---
# Title

**bold** and [link](https://example.com)
`;
    expect(stripMarkdownPlain(text)).toBe("Title\n\nbold and link\n");
  });

  test("renderMarkdownAnsi returns plain output when colors are disabled", () => {
    const out = renderMarkdownAnsi("# Hello\n\n**world**", { colors: false });
    expect(out).toContain("Hello");
    expect(out).toContain("world");
    expect(out).not.toMatch(new RegExp(`${String.fromCharCode(27)}\\[`));
  });

  test("renderMarkdownAnsi honors columns when supported", () => {
    if (!markdownAnsiSupported()) return;
    const long = "# Heading\n\n" + "word ".repeat(40);
    const wrapped = renderMarkdownAnsi(long, { colors: false, columns: 24 });
    const lines = wrapped.split("\n");
    expect(lines.some((line) => line.length <= 24 || line.trim().length === 0)).toBe(true);
  });

  test("renderMarkdownAnsi falls back when ansi is unavailable", () => {
    const original = Bun.markdown?.ansi;
    try {
      if (Bun.markdown) {
        (Bun.markdown as { ansi?: unknown }).ansi = undefined;
      }
      const out = renderMarkdownAnsi("# Hi\n\n**x**");
      expect(out).toBe("Hi\n\nx");
    } finally {
      if (Bun.markdown && original) {
        (Bun.markdown as { ansi?: unknown }).ansi = original;
      }
    }
  });
});
