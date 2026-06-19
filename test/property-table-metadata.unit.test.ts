import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  applyConfigMetadata,
  DEFAULT_CONFIG_METADATA_FIELDS,
  parseAddMetadataFlag,
  resolveConfigMetadataValues,
  resolveTomlScalarPath,
} from "../src/lib/property-table-metadata.ts";
import { applyTableRenderOptions } from "../src/lib/property-table-options.ts";
import { formatPropertyTableCsv } from "../src/lib/property-table-renderer.ts";
import { runPropertyTableExtractEffect } from "../src/lib/property-table-run.ts";
import { captureStdout, REPO_ROOT } from "./helpers.ts";

describe("property-table-metadata", () => {
  test("parseAddMetadataFlag defaults and explicit field lists", () => {
    expect(parseAddMetadataFlag(["--add-metadata"])).toEqual([...DEFAULT_CONFIG_METADATA_FIELDS]);
    expect(parseAddMetadataFlag(["--add-metadata", "name,runtime.bunVersion"])).toEqual([
      "name",
      "runtime.bunVersion",
    ]);
    expect(parseAddMetadataFlag(["--exact"])).toBeUndefined();
  });

  test("resolveTomlScalarPath reads root and nested scalars", () => {
    const doc = {
      schemaVersion: 1,
      name: "kimi-toolchain",
      runtime: { bunVersion: "1.4.0", containers: "none" },
      endpoints: [{ name: "x" }],
    };
    expect(resolveTomlScalarPath(doc, "schemaVersion")).toBe(1);
    expect(resolveTomlScalarPath(doc, "runtime.bunVersion")).toBe("1.4.0");
    expect(resolveTomlScalarPath(doc, "runtime.containers")).toBe("none");
    expect(resolveTomlScalarPath(doc, "endpoints")).toBeUndefined();
    expect(resolveTomlScalarPath(doc, "missing.path")).toBeUndefined();
  });

  test("applyConfigMetadata inserts columns before SourceFile", () => {
    const doc = { schemaVersion: 1, name: "demo", scope: "project" };
    const values = resolveConfigMetadataValues(doc, ["schemaVersion", "name"]);
    expect(values).toEqual({ schemaVersion: "1", name: "demo" });

    const enriched = applyConfigMetadata({
      columns: ["name", "url", "SourceFile"],
      rows: [{ name: "users", url: "https://example.com", SourceFile: "dx.config.toml" }],
      parsedToml: doc,
      fields: ["schemaVersion", "name"],
      tableMetadataColumns: ["SourceFile"],
    });
    expect(enriched.columns).toEqual(["name", "url", "schemaVersion", "config.name", "SourceFile"]);
    expect(enriched.rows[0]?.schemaVersion).toBe("1");
    expect(enriched.rows[0]?.name).toBe("users");
    expect(enriched.rows[0]?.["config.name"]).toBe("demo");
  });

  test("applyTableRenderOptions skips add-metadata when --exact", async () => {
    const doc = { schemaVersion: 1, name: "demo" };
    const out = applyTableRenderOptions({
      columns: ["name", "url"],
      rows: [{ name: "users", url: "https://example.com" }],
      filePath: "dx.config.toml",
      exact: true,
      addMetadataFields: ["schemaVersion", "name"],
      parsedToml: doc,
    });
    expect(out.columns).toEqual(["name", "url"]);
    expect(out.rows[0]?.schemaVersion).toBeUndefined();
  });

  test("runPropertyTableExtractEffect add-metadata enriches CSV rows", async () => {
    const capture = captureStdout();
    try {
      await Effect.runPromise(
        runPropertyTableExtractEffect({
          projectRoot: REPO_ROOT,
          file: "dx.config.toml",
          table: "endpoints",
          format: "csv",
          argv: [
            "--add-metadata",
            "schemaVersion,name,runtime.bunVersion",
            "--columns",
            "name,url,schemaVersion,config.name,runtime.bunVersion",
          ],
        })
      );
    } finally {
      capture.restore();
    }

    const csv = capture.lines.join("");
    expect(csv).toContain("schemaVersion");
    expect(csv).toContain("runtime.bunVersion");
    expect(csv).toContain("kimi-toolchain");
    expect(csv).toContain("1.4.0");
    expect(csv).toContain("cloudflare-mcp");
  });

  test("formatPropertyTableCsv includes metadata columns from fixture", () => {
    const payload = {
      title: "endpoints",
      sourceLabel: "fixture",
      markdown: "",
      columns: ["name", "url", "schemaVersion", "scope"],
      rows: [
        {
          name: "users",
          url: "https://example.com",
          schemaVersion: "1",
          scope: "project",
        },
      ],
    };
    const csv = formatPropertyTableCsv(payload);
    expect(csv).toContain("schemaVersion,scope");
    expect(csv).toContain("1,project");
  });
});
