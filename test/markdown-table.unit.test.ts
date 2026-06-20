import { describe, expect, test } from "bun:test";
import { join } from "path";
import { writeText } from "../src/lib/bun-io.ts";
import {
  formatMarkdownPropertyTable,
  inferMarkdownColumnKind,
  previewMarkdownWithBun,
  resolveMarkdownColumnSpecs,
} from "../src/lib/markdown-table.ts";
import { testTempDir } from "./helpers.ts";

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

  test("previewMarkdownWithBun renders a markdown file through bun ./file.md", async () => {
    const dir = testTempDir("markdown-terminal-preview-");
    const mdPath = join(dir, "preview.md");
    writeText(mdPath, "# Preview\n\n- terminal markdown\n");

    const preview = await previewMarkdownWithBun(mdPath);
    const combined = `${preview.stdout}\n${preview.stderr}`;

    expect(preview.exitCode).toBe(0);
    expect(combined).toContain("Preview");
    expect(combined).toContain("terminal markdown");
  });
});
