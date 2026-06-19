import { describe, expect, test } from "bun:test";
import { emptyToEmDash } from "../src/lib/markdown-table.ts";
import {
  applyTableRenderOptions,
  parseTableColumnsArg,
  parseTableExtractFlags,
  parseTableFilterArg,
} from "../src/lib/property-table-options.ts";
import { PROPERTY_TABLE_COLUMNS, type PropertyTableRow } from "../src/lib/property-table.ts";
import { buildTomlPropertyTable } from "../src/lib/toml-property-table.ts";
import { REPO_ROOT } from "./helpers.ts";

const FIXTURE = "test/fixtures/dx-remote-hosts.toml";
const ENDPOINTS = "test/fixtures/dx-url-endpoints.toml";
const TS_FIXTURE = "test/fixtures/property-table-target.ts";

function tsFixtureRow(property: string, type: string): PropertyTableRow {
  return Object.fromEntries(
    PROPERTY_TABLE_COLUMNS.map((col) => {
      if (col === "Property") return [col, property];
      if (col === "Type") return [col, type];
      if (col === "LastModified") return [col, "2026-01-01"];
      return [col, "—"];
    })
  ) as PropertyTableRow;
}

describe("property-table-options", () => {
  test("parseTableExtractFlags reads --exact, --preview, --sort-by", () => {
    expect(parseTableExtractFlags(["--exact", "--preview"])).toEqual({
      exact: true,
      preview: true,
      decomposeUrls: false,
      noSourceUrl: false,
      noHeader: false,
      columnPick: undefined,
      filters: [],
      groupBy: undefined,
      transpose: false,
      describe: false,
      describeKeys: undefined,
      sortBy: undefined,
      sortByDefault: false,
      schemaPath: undefined,
      schemaWarn: false,
      addMetadata: undefined,
    });
    expect(parseTableExtractFlags(["--decompose-urls", "--hide-source-url"])).toEqual({
      exact: false,
      preview: false,
      decomposeUrls: true,
      noSourceUrl: true,
      noHeader: false,
      columnPick: undefined,
      filters: [],
      groupBy: undefined,
      transpose: false,
      describe: false,
      describeKeys: undefined,
      sortBy: undefined,
      sortByDefault: false,
      schemaPath: undefined,
      schemaWarn: false,
      addMetadata: undefined,
    });
    expect(parseTableExtractFlags(["-u"])).toEqual({
      exact: false,
      preview: false,
      decomposeUrls: true,
      noSourceUrl: false,
      noHeader: false,
      columnPick: undefined,
      filters: [],
      groupBy: undefined,
      transpose: false,
      describe: false,
      describeKeys: undefined,
      sortBy: undefined,
      sortByDefault: false,
      schemaPath: undefined,
      schemaWarn: false,
      addMetadata: undefined,
    });
    expect(parseTableExtractFlags(["--sort-by", "Host"])).toEqual({
      exact: false,
      preview: false,
      decomposeUrls: false,
      noSourceUrl: false,
      noHeader: false,
      columnPick: undefined,
      filters: [],
      groupBy: undefined,
      transpose: false,
      describe: false,
      describeKeys: undefined,
      sortBy: "Host",
      sortByDefault: false,
      schemaPath: undefined,
      schemaWarn: false,
      addMetadata: undefined,
    });
    expect(parseTableExtractFlags(["--sort-by"])).toEqual({
      exact: false,
      preview: false,
      decomposeUrls: false,
      noSourceUrl: false,
      noHeader: false,
      columnPick: undefined,
      filters: [],
      groupBy: undefined,
      transpose: false,
      describe: false,
      describeKeys: undefined,
      sortBy: undefined,
      sortByDefault: true,
      schemaPath: undefined,
      schemaWarn: false,
      addMetadata: undefined,
    });
  });

  test("parseTableExtractFlags reads --describe and --keys", () => {
    expect(parseTableExtractFlags(["--describe", "--keys", "name", "--exact"])).toMatchObject({
      describe: true,
      describeKeys: "name",
      exact: true,
    });
  });

  test("parseTableExtractFlags reads --add-metadata", () => {
    expect(parseTableExtractFlags(["--add-metadata"])).toMatchObject({
      addMetadata: ["schemaVersion", "name", "scope"],
    });
    expect(
      parseTableExtractFlags(["--add-metadata", "schemaVersion,runtime.bunVersion"])
    ).toMatchObject({
      addMetadata: ["schemaVersion", "runtime.bunVersion"],
    });
  });

  test("parseTableExtractFlags reads --schema and --schema-warn", () => {
    expect(
      parseTableExtractFlags(["--schema", "schemas/endpoints.schema.toml", "--schema-warn"])
    ).toMatchObject({
      schemaPath: "schemas/endpoints.schema.toml",
      schemaWarn: true,
    });
  });

  test("parseTableColumnsArg and parseTableFilterArg", () => {
    expect(parseTableColumnsArg("name, url_hostname")).toEqual(["name", "url_hostname"]);
    expect(parseTableFilterArg("name=cloudflare-mcp")).toEqual({
      column: "name",
      value: "cloudflare-mcp",
    });
    expect(
      parseTableExtractFlags([
        "--columns",
        "name,url_hostname",
        "--filter",
        "name=cloudflare-mcp",
        "--no-header",
      ])
    ).toMatchObject({
      columnPick: ["name", "url_hostname"],
      filters: [{ column: "name", value: "cloudflare-mcp" }],
      noHeader: true,
    });
    expect(() => parseTableFilterArg("badfilter")).toThrow(/col=value/);
  });

  test("emptyToEmDash trims and normalizes blanks", () => {
    expect(emptyToEmDash("  hello  ")).toBe("hello");
    expect(emptyToEmDash("")).toBe("—");
    expect(emptyToEmDash(null)).toBe("—");
    expect(emptyToEmDash([])).toBe("—");
  });

  test("applyTableRenderOptions --exact omits metadata columns", async () => {
    const result = await buildTomlPropertyTable({
      projectRoot: REPO_ROOT,
      filePath: FIXTURE,
      tablePath: "herdr.orchestrator.remote_hosts",
    });
    const prepared = applyTableRenderOptions({
      columns: result.columns,
      rows: result.rows,
      filePath: result.filePath,
      exact: true,
    });
    expect(prepared.columns).not.toContain("LastModified");
    expect(prepared.columns).not.toContain("SourceFile");
    expect(prepared.rows[0]?.LastModified).toBeUndefined();
  });

  test("applyTableRenderOptions adds SourceFile when not exact", async () => {
    const result = await buildTomlPropertyTable({
      projectRoot: REPO_ROOT,
      filePath: FIXTURE,
      tablePath: "herdr.orchestrator.remote_hosts",
    });
    const prepared = applyTableRenderOptions({
      columns: result.columns,
      rows: result.rows,
      filePath: result.filePath,
      exact: false,
    });
    expect(prepared.columns).toContain("SourceFile");
    expect(prepared.rows.every((row) => row.SourceFile === FIXTURE)).toBe(true);
  });

  test("applyTableRenderOptions --exact on TypeScript Property/Type rows", () => {
    const rows = [
      tsFixtureRow("apiUrl", "string"),
      tsFixtureRow("timeout", "number"),
      tsFixtureRow("apiKey", "string"),
      tsFixtureRow("legacyMode", "boolean"),
    ];
    const prepared = applyTableRenderOptions({
      columns: PROPERTY_TABLE_COLUMNS,
      rows,
      filePath: TS_FIXTURE,
      exact: true,
      sortBy: "Property",
    });
    expect(prepared.columns).toContain("Property");
    expect(prepared.columns).toContain("Type");
    expect(prepared.columns).not.toContain("LastModified");
    expect(prepared.rows.map((row) => row.Property)).toEqual([
      "apiKey",
      "apiUrl",
      "legacyMode",
      "timeout",
    ]);
  });

  test("applyTableRenderOptions --columns and --filter", async () => {
    const result = await buildTomlPropertyTable({
      projectRoot: REPO_ROOT,
      filePath: "dx.config.toml",
      tablePath: "endpoints",
    });
    const prepared = applyTableRenderOptions({
      columns: result.columns,
      rows: result.rows,
      filePath: result.filePath,
      exact: true,
      decomposeUrls: true,
      columnPick: ["name", "url_hostname"],
      filters: [{ column: "name", value: "cloudflare-mcp" }],
    });
    expect(prepared.columns).toEqual(["name", "url_hostname"]);
    expect(prepared.rows).toHaveLength(1);
    expect(prepared.rows[0]?.name).toBe("cloudflare-mcp");
    expect(prepared.rows[0]?.url_hostname).toBe("mcp.cloudflare.com");
  });

  test("parseTableFilterArg and parseTableColumnsArg", () => {
    expect(parseTableFilterArg("name=users")).toEqual({ column: "name", value: "users" });
    expect(parseTableColumnsArg("name,url_hostname,url_port")).toEqual([
      "name",
      "url_hostname",
      "url_port",
    ]);
    expect(() => parseTableFilterArg("bad")).toThrow(/col=value/);
  });

  test("parseTableExtractFlags reads --group-by and --transpose", () => {
    const flags = parseTableExtractFlags(["--group-by", "url_hostname", "--transpose", "--exact"]);
    expect(flags.groupBy).toBe("url_hostname");
    expect(flags.transpose).toBe(true);
    expect(flags.exact).toBe(true);
  });

  test("parseTableExtractFlags reads csv projection flags", () => {
    const flags = parseTableExtractFlags([
      "--format",
      "csv",
      "--columns",
      "name,url",
      "--filter",
      "name=users",
      "--no-header",
    ]);
    expect(flags.noHeader).toBe(true);
    expect(flags.columnPick).toEqual(["name", "url"]);
    expect(flags.filters).toEqual([{ column: "name", value: "users" }]);
  });

  test("applyTableRenderOptions filters and picks columns for CSV", async () => {
    const built = await buildTomlPropertyTable({
      projectRoot: REPO_ROOT,
      filePath: ENDPOINTS,
      tablePath: "endpoints",
    });
    const prepared = applyTableRenderOptions({
      columns: built.columns,
      rows: built.rows,
      filePath: built.filePath,
      exact: true,
      decomposeUrls: true,
      filters: [{ column: "name", value: "users" }],
      columnPick: ["name", "url_hostname", "url_port"],
    });
    expect(prepared.rows).toHaveLength(1);
    expect(prepared.columns).toEqual(["name", "url_hostname", "url_port"]);
    expect(prepared.rows[0]?.url_port).toBe("8443");
  });

  test("applyTableRenderOptions --sort-by orders rows", async () => {
    const result = await buildTomlPropertyTable({
      projectRoot: REPO_ROOT,
      filePath: FIXTURE,
      tablePath: "herdr.orchestrator.remote_hosts",
    });
    const prepared = applyTableRenderOptions({
      columns: result.columns,
      rows: result.rows,
      filePath: result.filePath,
      exact: true,
      sortBy: "Host",
    });
    expect(prepared.rows.map((row) => row.Host)).toEqual(["staging", "workbox"]);
  });
});
