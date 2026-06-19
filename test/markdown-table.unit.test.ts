import { describe, expect, test } from "bun:test";
import {
  formatMarkdownPropertyTable,
  inferMarkdownColumnKind,
  resolveMarkdownColumnSpecs,
} from "../src/lib/markdown-table.ts";

describe("markdown-table", () => {
  test("inferMarkdownColumnKind detects numbers and dates", () => {
    const rows = [
      { Port: "2222", LastModified: "2026-06-17", Host: "staging" },
      { Port: "—", LastModified: "2026-06-16", Host: "workbox" },
    ];
    expect(inferMarkdownColumnKind("Port", rows)).toBe("number");
    expect(inferMarkdownColumnKind("LastModified", rows)).toBe("date");
    expect(inferMarkdownColumnKind("Host", rows)).toBe("text");
  });

  test("resolveMarkdownColumnSpecs applies right-align for numeric columns", () => {
    const specs = resolveMarkdownColumnSpecs(
      ["Host", "Port"],
      [{ Host: "staging", Port: "2222" }],
      [
        { name: "Host", kind: "text" },
        { name: "Port", kind: "number" },
      ]
    );
    expect(specs[0]?.align).toBe("left");
    expect(specs[1]?.align).toBe("right");
  });

  test("formatMarkdownPropertyTable emits GFM alignment separators", () => {
    const md = formatMarkdownPropertyTable({
      title: "demo",
      source: "dx.config.toml",
      columns: ["Host", "Port", "LastModified"],
      rows: [{ Host: "staging", Port: "2222", LastModified: "2026-06-17" }],
      columnSpecs: [
        { name: "Host", kind: "text" },
        { name: "Port", kind: "number" },
        { name: "LastModified", kind: "date" },
      ],
    });
    expect(md).toContain("| :--- | ---: | ---: |");
    expect(md).toContain("| staging | 2222 | 2026-06-17 |");
    expect(md).toContain("Source: `dx.config.toml`");
  });
});
