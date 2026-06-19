import { describe, expect, test } from "bun:test";
import { applyTableRenderOptions } from "../src/lib/property-table-options.ts";
import {
  formatTableSchemaViolations,
  loadTableSchema,
  validateTableAgainstSchema,
  type TableSchema,
} from "../src/lib/table-schema.ts";
import { buildTomlPropertyTable } from "../src/lib/toml-property-table.ts";
import { REPO_ROOT } from "./helpers.ts";

const ENDPOINTS = "test/fixtures/dx-url-endpoints.toml";
const SCHEMA = "schemas/endpoints.schema.toml";
const STRICT_SCHEMA = "schemas/endpoints-strict.schema.toml";

describe("table-schema", () => {
  test("loadTableSchema reads TOML required and column rules", async () => {
    const schema = await loadTableSchema(REPO_ROOT, SCHEMA);
    expect(schema.required).toEqual(["name", "url", "url_protocol", "url_hostname"]);
    expect(schema.columns.url?.pattern).toBe("^https?://");
    expect(schema.columns.url_protocol?.enum).toEqual(["https:", "http:"]);
    expect(schema.columns.url_hostname?.minLength).toBe(1);
    expect(schema.columns.url_port?.max).toBe(65535);
  });

  test("validateTableAgainstSchema passes prepared endpoints with -u --exact", async () => {
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
    });
    const schema = await loadTableSchema(REPO_ROOT, SCHEMA);
    const violations = validateTableAgainstSchema(prepared.columns, prepared.rows, schema);
    expect(violations).toEqual([]);
  });

  test("validateTableAgainstSchema reports missing required column", () => {
    const schema = {
      required: ["name", "url"],
      columns: { url: { pattern: "^https?://" } },
    };
    const violations = validateTableAgainstSchema(["name"], [{ name: "users" }], schema);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("missing required column");
  });

  test("validateTableAgainstSchema reports pattern mismatch", () => {
    const schema = {
      required: ["name", "url"],
      columns: { url: { pattern: "^https?://" } },
    };
    const violations = validateTableAgainstSchema(
      ["name", "url"],
      [{ name: "users", url: "ftp://bad" }],
      schema
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("pattern");
  });

  test("validateTableAgainstSchema enforces enum, length, and numeric bounds", () => {
    const schema = {
      required: ["name", "url_protocol", "url_hostname", "url_port"],
      columns: {
        url_protocol: { enum: ["https:", "http:"] },
        url_hostname: { minLength: 3, maxLength: 10 },
        url_port: { type: "integer" as const, min: 1, max: 65535 },
      },
    } satisfies TableSchema;
    const violations = validateTableAgainstSchema(
      ["name", "url_protocol", "url_hostname", "url_port"],
      [
        {
          name: "bad",
          url_protocol: "ftp:",
          url_hostname: "ab",
          url_port: "70000",
        },
      ],
      schema
    );
    expect(violations.map((v) => v.message)).toEqual([
      'enum mismatch: expected one of [https:, http:], got "ftp:"',
      "minLength 3 not met (length 2)",
      "max 65535 exceeded (value 70000)",
    ]);
  });

  test("validateTableAgainstSchema enforces custom expressions", () => {
    const schema = {
      required: ["url_pathname"],
      columns: {
        url_pathname: { custom: "value.startsWith('/') && !value.includes('..')" },
      },
    };
    const ok = validateTableAgainstSchema(
      ["url_pathname"],
      [{ url_pathname: "/v2/users" }],
      schema
    );
    const bad = validateTableAgainstSchema(
      ["url_pathname"],
      [{ url_pathname: "/v2/../etc" }],
      schema
    );
    expect(ok).toEqual([]);
    expect(bad[0]?.message).toContain("custom expression failed");
  });

  test("strict endpoints schema passes fixture paths", async () => {
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
    });
    const schema = await loadTableSchema(REPO_ROOT, STRICT_SCHEMA);
    const violations = validateTableAgainstSchema(prepared.columns, prepared.rows, schema);
    expect(violations).toEqual([]);
  });

  test("formatTableSchemaViolations includes row and column context", () => {
    const text = formatTableSchemaViolations("schemas/foo.toml", [
      { row: 0, column: "url", value: "", message: "missing required column in table output" },
      { row: 2, column: "name", value: "", message: "required value is empty" },
    ]);
    expect(text).toContain("schema schemas/foo.toml: column url:");
    expect(text).toContain('row 2 column name: required value is empty (value="")');
  });

  test("loadTableSchema rejects missing file", async () => {
    await expect(loadTableSchema(REPO_ROOT, "schemas/missing.schema.toml")).rejects.toThrow(
      /not found/
    );
  });
});
