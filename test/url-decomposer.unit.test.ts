import { describe, expect, test } from "bun:test";
import { join } from "path";
import { formatMarkdownPropertyTable, previewMarkdownWithBun } from "../src/lib/markdown-table.ts";
import { applyTableRenderOptions } from "../src/lib/property-table-options.ts";
import {
  applyUrlDecomposition,
  decomposeUrl,
  decomposedColumnName,
  detectUrlColumns,
  looksLikeAbsoluteUrl,
} from "../src/lib/url-decomposer.ts";
import { buildTomlPropertyTable } from "../src/lib/toml-property-table.ts";
import { REPO_ROOT, testTempDir } from "./helpers.ts";

const ROWS = [
  {
    name: "users",
    url: "https://api.example.com:8443/v2/users/42?status=active#main",
  },
  {
    name: "health",
    url: "https://api.example.com/health",
  },
];

describe("url-decomposer", () => {
  test("looksLikeAbsoluteUrl requires scheme and rejects relative paths", () => {
    expect(looksLikeAbsoluteUrl("https://api.example.com/v2/run/42")).toBe(true);
    expect(looksLikeAbsoluteUrl("wss://stream.example.com/events")).toBe(true);
    expect(looksLikeAbsoluteUrl("/v2/run/42")).toBe(false);
    expect(looksLikeAbsoluteUrl("not-a-url")).toBe(false);
    expect(looksLikeAbsoluteUrl("—")).toBe(false);
  });

  test("decomposeUrl splits URL components", () => {
    expect(decomposeUrl("https://api.example.com:8443/v2/users/42?status=active#main")).toEqual({
      protocol: "https:",
      hostname: "api.example.com",
      port: "8443",
      pathname: "/v2/users/42",
      search: "?status=active",
      hash: "#main",
    });
    expect(decomposeUrl("https://api.example.com/health").port).toBe("—");
  });

  test("decomposedColumnName prefixes source column", () => {
    expect(decomposedColumnName("url", "protocol")).toBe("url_protocol");
    expect(decomposedColumnName("url", "pathname")).toBe("url_pathname");
  });

  test("detectUrlColumns finds url-named columns with absolute URLs", () => {
    expect(detectUrlColumns(["name", "url"], ROWS)).toEqual(["url"]);
  });

  test("applyUrlDecomposition inserts url_* in-place before trailing columns", () => {
    const result = applyUrlDecomposition({
      columns: ["name", "description", "url", "LastModified"],
      rows: [
        {
          name: "api",
          description: "primary",
          url: "https://api.example.com/v1",
          LastModified: "2026-06-17",
        },
      ],
    });
    expect(result.columns).toEqual([
      "name",
      "description",
      "url",
      "url_protocol",
      "url_hostname",
      "url_port",
      "url_pathname",
      "url_search",
      "url_hash",
      "LastModified",
    ]);
  });

  test("applyUrlDecomposition appends url_* columns after url", () => {
    const result = applyUrlDecomposition({
      columns: ["name", "url"],
      rows: ROWS,
    });
    expect(result.columns).toEqual([
      "name",
      "url",
      "url_protocol",
      "url_hostname",
      "url_port",
      "url_pathname",
      "url_search",
      "url_hash",
    ]);
    const users = result.rows.find((r) => r.name === "users")!;
    expect(users.url_protocol).toBe("https:");
    expect(users.url_hostname).toBe("api.example.com");
    expect(users.url_port).toBe("8443");
    expect(users.url_pathname).toBe("/v2/users/42");
    expect(users.url_search).toBe("?status=active");
    expect(users.url_hash).toBe("#main");
    const health = result.rows.find((r) => r.name === "health")!;
    expect(health.url_port).toBe("—");
  });

  test("applyUrlDecomposition --hide-source-url omits original url column", () => {
    const result = applyUrlDecomposition({
      columns: ["name", "url"],
      rows: ROWS,
      noSourceUrl: true,
    });
    expect(result.columns).toEqual([
      "name",
      "url_protocol",
      "url_hostname",
      "url_port",
      "url_pathname",
      "url_search",
      "url_hash",
    ]);
    expect(result.rows[0]?.url).toBeUndefined();
    expect(result.rows[0]?.url_hostname).toBe("api.example.com");
  });

  test("relative-only url column is left untouched", () => {
    const result = applyUrlDecomposition({
      columns: ["name", "url"],
      rows: [{ name: "bad", url: "/relative/path" }],
    });
    expect(result.columns).toEqual(["name", "url"]);
    expect(result.rows[0]?.url).toBe("/relative/path");
  });

  test("invalid row in url column keeps source; decomposed cells are em dash", () => {
    const result = applyUrlDecomposition({
      columns: ["name", "url"],
      rows: [
        { name: "ok", url: "https://api.example.com/x" },
        { name: "bad", url: "/relative/path" },
      ],
    });
    expect(result.rows[1]?.url).toBe("/relative/path");
    expect(result.rows[1]?.url_protocol).toBe("—");
    expect(result.rows[0]?.url_pathname).toBe("/x");
  });

  test("applyTableRenderOptions runs decompose before sort and metadata", () => {
    const prepared = applyTableRenderOptions({
      columns: ["name", "url"],
      rows: ROWS,
      filePath: "fixture.toml",
      decomposeUrls: true,
      sortBy: "name",
    });
    expect(prepared.columns).toContain("url_pathname");
    expect(prepared.columns).toContain("SourceFile");
    expect(prepared.rows[0]?.name).toBe("health");
  });

  test("dx.config.toml endpoints table column order with --decompose-urls", async () => {
    const built = await buildTomlPropertyTable({
      projectRoot: REPO_ROOT,
      filePath: "dx.config.toml",
      tablePath: "endpoints",
    });
    const prepared = applyTableRenderOptions({
      columns: built.columns,
      rows: built.rows,
      filePath: built.filePath,
      decomposeUrls: true,
      exact: true,
      columnSpecs: [
        { name: "name", kind: "text" },
        { name: "url", kind: "text" },
      ],
    });
    expect(prepared.columns).toEqual([
      "name",
      "url",
      "url_protocol",
      "url_hostname",
      "url_port",
      "url_pathname",
      "url_search",
      "url_hash",
    ]);
    const mcp = prepared.rows.find((r) => r.name === "cloudflare-mcp")!;
    expect(mcp.url_protocol).toBe("https:");
    expect(mcp.url_hostname).toBe("mcp.cloudflare.com");
    expect(mcp.url_pathname).toBe("/mcp");
    const skill = prepared.rows.find((r) => r.name === "herdr-skill")!;
    expect(skill.url_hostname).toBe("github.com");
    expect(skill.url_pathname).toContain("/herdr/blob/");
  });

  test("endpoints fixture with --decompose-urls produces aligned markdown", async () => {
    const built = await buildTomlPropertyTable({
      projectRoot: REPO_ROOT,
      filePath: "test/fixtures/dx-url-endpoints.toml",
      tablePath: "endpoints",
    });
    const prepared = applyTableRenderOptions({
      columns: built.columns,
      rows: built.rows,
      filePath: built.filePath,
      decomposeUrls: true,
      columnSpecs: [
        { name: "name", kind: "text" },
        { name: "url", kind: "text" },
      ],
    });
    const md = formatMarkdownPropertyTable({
      title: "endpoints",
      source: built.filePath,
      columns: prepared.columns,
      rows: prepared.rows,
      columnSpecs: prepared.columnSpecs,
    });
    expect(md).toContain("| name | url | url_protocol | url_hostname | url_port | url_pathname |");
    expect(md).toContain("?status=active");
    expect(md).toContain("#main");

    const dir = testTempDir("url-endpoints-render-");
    const mdPath = join(dir, "table.md");
    await Bun.write(mdPath, md);
    const preview = await previewMarkdownWithBun(mdPath);
    const combined = `${preview.stdout}\n${preview.stderr}`;
    expect(preview.exitCode).toBe(0);
    expect(combined).toContain("users");
    expect(combined).toContain("8443");
  }, 15_000);
});
