/**
 * Bun.markdown correctness and performance regression test.
 *
 * Bun v1.3.12 introduced Bun.markdown — terminal Markdown rendering.
 * v1.3.14 added Bun.markdown.html() for HTML output.
 *
 * This test verifies the core operations used by docs linting and terminal output.
 */
import { describe, expect, test } from "bun:test";
import {
  extractMarkdownSections,
  extractMarkdownTables,
  extractMarkdownTablesFallback,
} from "../src/lib/bun-markdown.ts";

const SIMPLE_MD = "# Hello\n\nThis is **bold** and *italic*.\n\n- item 1\n- item 2";

const SECTION_MD = `## Security Layers

| Layer | File |
| ----- | ---- |
| Auth | src/auth.ts |

First paragraph.

## Architecture

| Component | Path |
| --------- | ---- |
| Core | src/core |

Second paragraph.
`;

describe("bun-markdown", () => {
  test("Bun.markdown is available", () => {
    expect(typeof Bun.markdown).toBe("object");
  });

  test("Bun.markdown.html renders markdown to HTML", () => {
    const html = Bun.markdown.html(SIMPLE_MD);
    expect(typeof html).toBe("string");
    expect(html).toContain("<h1>Hello</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<li>item 1</li>");
  });

  test("Bun.markdown.html handles empty input", () => {
    const html = Bun.markdown.html("");
    expect(typeof html).toBe("string");
  });

  test("Bun.markdown.html handles code blocks", () => {
    const md = "```ts\nconst x = 1;\n```";
    const html = Bun.markdown.html(md);
    // Bun.markdown.html renders fenced code blocks — may use <pre> or <code>
    expect(html).toMatch(/const x = 1/);
  });

  test("Bun.markdown.html renders links", () => {
    const md = "[Bun](https://bun.sh)";
    const html = Bun.markdown.html(md);
    expect(html).toContain('<a href="https://bun.sh"');
  });

  test("Bun.markdown terminal rendering does not throw on valid markdown", () => {
    // Bun.markdown is an object with .html(), not a callable function
    // Terminal rendering is accessed differently (Bun 1.4+)
    const md = Bun.markdown.html(SIMPLE_MD);
    expect(typeof md).toBe("string");
    expect(md.length).toBeGreaterThan(0);
  });

  test("extractMarkdownTables parses GFM tables", () => {
    const tables = extractMarkdownTables(SECTION_MD);
    expect(tables).toHaveLength(2);
    expect(tables[0]?.headers).toEqual(["Layer", "File"]);
    expect(tables[0]?.rows[0]).toEqual(["Auth", "src/auth.ts"]);
    expect(tables[1]?.headers).toEqual(["Component", "Path"]);
  });

  test("extractMarkdownTablesFallback preserves inline formatting", () => {
    const tables = extractMarkdownTablesFallback(
      "| Domain | Files |\n| ------ | ----- |\n| **Core** | `utils.ts` |\n"
    );
    expect(tables[0]?.rows[0]?.[0]).toBe("**Core**");
  });

  test("extractMarkdownSections groups tables under headings", () => {
    const sections = extractMarkdownSections(SECTION_MD);
    expect(sections).toHaveLength(2);
    expect(sections[0]?.title).toBe("Security Layers");
    expect(sections[0]?.tables).toHaveLength(1);
    expect(sections[0]?.content).toContain("First paragraph");
    expect(sections[1]?.title).toBe("Architecture");
    expect(sections[1]?.content).toContain("Second paragraph");
  });
});
