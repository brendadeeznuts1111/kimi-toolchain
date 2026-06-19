import { describe, expect, test } from "bun:test";
import { join } from "path";
import { Effect } from "effect";
import {
  buildDescribePayloads,
  describeMarkdownPath,
  formatDescribeMarkdown,
  formatDescribeMarkdownStdout,
} from "../src/lib/property-table-describe.ts";
import { formatDescribeJson } from "../src/lib/property-table-renderer.ts";
import { runPropertyTableExtractEffect } from "../src/lib/property-table-run.ts";
import { captureStdout, REPO_ROOT, testTempDir } from "./helpers.ts";

const ENDPOINTS = "test/fixtures/dx-url-endpoints.toml";

describe("property-table-describe", () => {
  test("formatDescribeMarkdown emits sections keyed by --keys column", () => {
    const md = formatDescribeMarkdown({
      title: "endpoints",
      source: "dx.config.toml",
      keyColumn: "name",
      columns: ["name", "url"],
      rows: [
        { name: "cloudflare-mcp", url: "https://mcp.cloudflare.com/mcp" },
        { name: "herdr-skill", url: "https://github.com/example/SKILL.md" },
      ],
    });
    expect(md).toContain("# endpoints");
    expect(md).toContain("## cloudflare-mcp");
    expect(md).toContain("- **url**: `https://mcp.cloudflare.com/mcp`");
    expect(md).not.toContain("- **name**:");
    expect(md).toContain("## herdr-skill");
  });

  test("buildDescribePayloads creates one payload per row", () => {
    const payloads = buildDescribePayloads({
      baseTitle: "endpoints",
      sourceLabel: "fixture",
      filePath: ENDPOINTS,
      keyColumn: "name",
      columns: ["name", "url"],
      rows: [
        { name: "users", url: "https://api.example.com/users" },
        { name: "staging", url: "https://api.staging.example.com" },
      ],
    });
    expect(payloads).toHaveLength(2);
    expect(payloads[0]?.entryKey).toBe("users");
    expect(payloads[0]?.markdown).toContain("## users");
  });

  test("formatDescribeMarkdownStdout joins entry docs with horizontal rule", () => {
    const out = formatDescribeMarkdownStdout([
      {
        title: "a",
        sourceLabel: "x",
        markdown: "# a\n\n## one\n",
        rows: [],
        columns: [],
      },
      {
        title: "b",
        sourceLabel: "x",
        markdown: "# b\n\n## two\n",
        rows: [],
        columns: [],
      },
    ]);
    expect(out).toContain("## one");
    expect(out).toContain("---");
    expect(out).toContain("## two");
  });

  test("describeMarkdownPath writes under docs/describe", () => {
    const path = describeMarkdownPath("/proj/docs/describe", "endpoints");
    expect(path).toBe(join("/proj/docs/describe", "table-endpoints.md"));
  });

  test("formatDescribeJson emits entries keyed by --keys column", () => {
    const payload = {
      title: "endpoints",
      sourceLabel: "dx.config.toml",
      markdown: "",
      columns: ["name", "url"],
      rows: [
        { name: "cloudflare-mcp", url: "https://mcp.cloudflare.com/mcp" },
        { name: "herdr-skill", url: "https://github.com/example/SKILL.md" },
      ],
    };
    const out = formatDescribeJson(payload, "name");
    const parsed = JSON.parse(out);
    expect(parsed.keyColumn).toBe("name");
    expect(parsed.entries["cloudflare-mcp"]).toEqual({
      name: "cloudflare-mcp",
      url: "https://mcp.cloudflare.com/mcp",
    });
    expect(parsed.entries["herdr-skill"]).toEqual({
      name: "herdr-skill",
      url: "https://github.com/example/SKILL.md",
    });
  });

  test("runPropertyTableExtractEffect describe writes catalog file", async () => {
    const outDir = testTempDir("dx-describe-");
    await Effect.runPromise(
      runPropertyTableExtractEffect({
        projectRoot: REPO_ROOT,
        file: ENDPOINTS,
        table: "endpoints",
        outDir,
        argv: ["--describe", "--keys", "name", "--exact"],
      })
    );
    const catalogPath = join(outDir, "table-endpoints.md");
    const text = await Bun.file(catalogPath).text();
    expect(text).toContain("## users");
    expect(text).toContain("## staging");
    expect(text).not.toContain("| name |");
  });

  test("runPropertyTableExtractEffect describe json prints keyed JSON to stdout", async () => {
    const capture = captureStdout();
    try {
      await Effect.runPromise(
        runPropertyTableExtractEffect({
          projectRoot: REPO_ROOT,
          file: ENDPOINTS,
          table: "endpoints",
          format: "json",
          argv: ["--describe", "--keys", "name", "--exact"],
        })
      );
    } finally {
      capture.restore();
    }

    const out = capture.lines.join("");
    const parsed = JSON.parse(out);
    expect(parsed.keyColumn).toBe("name");
    expect(parsed.entries["users"]).toBeDefined();
    expect(parsed.entries["users"].url).toContain("https://");
  });

  test("runPropertyTableExtractEffect describe raw prints to stdout", async () => {
    const capture = captureStdout();
    try {
      await Effect.runPromise(
        runPropertyTableExtractEffect({
          projectRoot: REPO_ROOT,
          file: ENDPOINTS,
          table: "endpoints",
          format: "raw",
          argv: ["--describe", "--keys", "name", "--exact"],
        })
      );
    } finally {
      capture.restore();
    }

    const out = capture.lines.join("");
    expect(out).toContain("## users");
    expect(out).toContain("## health");
    expect(out).not.toContain("| name |");
  });
});
