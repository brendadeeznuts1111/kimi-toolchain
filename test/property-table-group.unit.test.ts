import { describe, expect, test } from "bun:test";
import { join } from "path";
import {
  buildGroupedPayloads,
  formatGroupedMarkdownStdout,
  groupedMarkdownPath,
  slugifyGroupKey,
  transposeTable,
} from "../src/lib/property-table-group.ts";
import { runPropertyTableExtractEffect } from "../src/lib/property-table-run.ts";
import { Effect } from "effect";
import { captureStdout, REPO_ROOT, testTempDir } from "./helpers.ts";

const ENDPOINTS = "test/fixtures/dx-url-endpoints.toml";

describe("property-table-group", () => {
  test("slugifyGroupKey preserves hostname dots", () => {
    expect(slugifyGroupKey("api.example.com")).toBe("api.example.com");
    expect(slugifyGroupKey("—")).toBe("unknown");
  });

  test("transposeTable flips columns and uses name as column header", () => {
    const flipped = transposeTable(
      ["name", "url_hostname"],
      [{ name: "cloudflare-mcp", url_hostname: "mcp.cloudflare.com" }]
    );
    expect(flipped.columns).toEqual(["Field", "cloudflare-mcp"]);
    expect(flipped.rows).toEqual([
      { Field: "name", "cloudflare-mcp": "cloudflare-mcp" },
      { Field: "url_hostname", "cloudflare-mcp": "mcp.cloudflare.com" },
    ]);
  });

  test("buildGroupedPayloads splits rows by column", () => {
    const groups = buildGroupedPayloads({
      baseTitle: "endpoints",
      sourceLabel: "fixture",
      filePath: ENDPOINTS,
      columns: ["name", "url_hostname"],
      rows: [
        { name: "users", url_hostname: "api.example.com" },
        { name: "staging", url_hostname: "api.staging.example.com" },
      ],
      groupBy: "url_hostname",
    });
    expect(groups).toHaveLength(2);
    expect(groups[0]?.rows).toHaveLength(1);
    expect(groups[0]?.markdown).toContain("url_hostname=api.example.com");
  });

  test("formatGroupedMarkdownStdout joins sections with horizontal rule", () => {
    const out = formatGroupedMarkdownStdout([
      {
        title: "a",
        sourceLabel: "x",
        markdown: "# a\n",
        rows: [],
        columns: [],
      },
      {
        title: "b",
        sourceLabel: "x",
        markdown: "# b\n",
        rows: [],
        columns: [],
      },
    ]);
    expect(out).toContain("# a");
    expect(out).toContain("---");
    expect(out).toContain("# b");
  });

  test("groupedMarkdownPath encodes hostname in filename", () => {
    const path = groupedMarkdownPath("/proj/docs/groups", "endpoints", "api.example.com");
    expect(path).toBe(join("/proj/docs/groups", "table-endpoints-api.example.com.md"));
  });

  test("runPropertyTableExtractEffect group-by transpose writes vertical tables", async () => {
    const outDir = testTempDir("dx-group-transpose-");
    await Effect.runPromise(
      runPropertyTableExtractEffect({
        projectRoot: REPO_ROOT,
        file: "dx.config.toml",
        table: "endpoints",
        outDir,
        format: "file",
        argv: ["--exact", "-u", "--group-by", "url_hostname", "--transpose"],
      })
    );
    const mcp = Bun.file(join(outDir, "table-endpoints-mcp.cloudflare.com.md"));
    expect(await mcp.exists()).toBe(true);
    const text = await mcp.text();
    expect(text).toContain("| Field | cloudflare-mcp |");
    expect(text).toContain("url_hostname");
  });

  test("runPropertyTableExtractEffect writes one file per hostname", async () => {
    const outDir = testTempDir("dx-group-files-");
    await Effect.runPromise(
      runPropertyTableExtractEffect({
        projectRoot: REPO_ROOT,
        file: ENDPOINTS,
        table: "endpoints",
        outDir,
        format: "file",
        argv: ["--exact", "-u", "--group-by", "url_hostname"],
      })
    );
    const example = Bun.file(join(outDir, "table-endpoints-api.example.com.md"));
    const staging = Bun.file(join(outDir, "table-endpoints-api.staging.example.com.md"));
    expect(await example.exists()).toBe(true);
    expect(await staging.exists()).toBe(true);
    const exampleText = await example.text();
    expect(exampleText).toContain("users");
    expect(exampleText).toContain("health");
    expect(await staging.text()).toContain("staging");
  });

  test("runPropertyTableExtractEffect emits grouped markdown to stdout", async () => {
    const stdout = captureStdout();

    try {
      await Effect.runPromise(
        runPropertyTableExtractEffect({
          projectRoot: REPO_ROOT,
          file: ENDPOINTS,
          table: "endpoints",
          format: "raw",
          argv: ["--exact", "-u", "--group-by", "url_hostname", "--format", "markdown"],
        })
      );
      const combined = stdout.lines.join("");
      expect(combined).toContain("---");
      expect(combined).toContain("api.example.com");
      expect(combined).toContain("api.staging.example.com");
    } finally {
      stdout.restore();
    }
  });
});
