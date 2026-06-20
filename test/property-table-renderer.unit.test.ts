import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { join } from "path";
import {
  defaultPropertyTableMarkdownPath,
  emitPropertyTableOutput,
  formatPropertyTableCsv,
  formatPropertyTableInspect,
  formatPropertyTableJson,
  parseLegacyAnsiFlag,
  parsePropertyTableFormat,
  propertyTableFormatDeprecated,
  type PropertyTableRenderPayload,
} from "../src/lib/property-table-renderer.ts";
import { applyTableRenderOptions } from "../src/lib/property-table-options.ts";
import { buildTomlPropertyTable } from "../src/lib/toml-property-table.ts";
import { captureStdout, REPO_ROOT, testTempDir } from "./helpers.ts";

const ENDPOINTS = "test/fixtures/dx-url-endpoints.toml";

const SAMPLE: PropertyTableRenderPayload = {
  title: "demo.table",
  sourceLabel: "dx.config.toml",
  markdown: [
    "# demo.table",
    "",
    "| Host | Port |",
    "| :--- | ---: |",
    "| staging | 2222 |",
    "",
  ].join("\n"),
  rows: [{ Host: "staging", Port: "2222" }],
  columns: ["Host", "Port"],
};

describe("property-table-renderer", () => {
  test("parsePropertyTableFormat defaults to file", () => {
    expect(parsePropertyTableFormat([])).toBe("file");
    expect(parsePropertyTableFormat(["--format", "table"])).toBe("table");
    expect(parsePropertyTableFormat(["--format", "raw"])).toBe("raw");
    expect(parsePropertyTableFormat(["--format", "markdown"])).toBe("raw");
    expect(parsePropertyTableFormat(["--format", "csv"])).toBe("csv");
    expect(parsePropertyTableFormat(["--format", "json"])).toBe("json");
    expect(parsePropertyTableFormat(["--format", "ansi"])).toBe("file");
  });

  test("propertyTableFormatDeprecated flags removed ansi format", () => {
    expect(propertyTableFormatDeprecated(["--format", "ansi"])).toBe(true);
    expect(propertyTableFormatDeprecated(["--format", "raw"])).toBe(false);
  });

  test("parseLegacyAnsiFlag reads --legacy-ansi", () => {
    expect(parseLegacyAnsiFlag(["--legacy-ansi"])).toBe(true);
    expect(parseLegacyAnsiFlag([])).toBe(false);
  });

  test("defaultPropertyTableMarkdownPath writes under docs/", () => {
    const path = defaultPropertyTableMarkdownPath("/proj", "herdr.orchestrator.remote_hosts");
    expect(path).toBe("/proj/docs/table-herdr-orchestrator-remote_hosts.md");
  });

  test("defaultPropertyTableMarkdownPath honors --out-dir", () => {
    const path = defaultPropertyTableMarkdownPath("/proj", "demo", { outDir: "/proj/out" });
    expect(path).toBe("/proj/out/table-demo.md");
  });

  test("formatPropertyTableCsv omits header with noHeader", () => {
    const csv = formatPropertyTableCsv(
      { ...SAMPLE, rows: [{ Host: "staging", Port: "2222" }], columns: ["Host", "Port"] },
      { noHeader: true }
    );
    expect(csv).toBe("staging,2222\n");
  });

  test("formatPropertyTableCsv emits header and escaped rows", () => {
    const csv = formatPropertyTableCsv({
      ...SAMPLE,
      rows: [
        { Host: "staging", Port: "2222" },
        { Host: "a,b", Port: "x" },
      ],
      columns: ["Host", "Port"],
    });
    expect(csv).toBe('Host,Port\nstaging,2222\n"a,b",x\n');
  });

  test("emitPropertyTableOutput csv writes filtered projection to stdout", async () => {
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
      filters: [{ column: "name", value: "health" }],
      columnPick: ["name", "url_pathname"],
    });
    const capture = captureStdout();
    try {
      await Effect.runPromise(
        emitPropertyTableOutput(
          {
            title: "endpoints",
            sourceLabel: ENDPOINTS,
            markdown: "",
            columns: prepared.columns,
            rows: prepared.rows,
          },
          { format: "csv", markdownPath: "/tmp/unused.md" }
        )
      );
      expect(capture.lines.join("")).toBe("name,url_pathname\nhealth,/health\n");
    } finally {
      capture.restore();
    }
  });

  test("emitPropertyTableOutput csv writes CSV only to stdout", async () => {
    const dir = testTempDir("pt-renderer-csv-");
    const mdPath = join(dir, "out.md");
    const capture = captureStdout();
    try {
      await Effect.runPromise(
        emitPropertyTableOutput(SAMPLE, {
          format: "csv",
          markdownPath: mdPath,
        })
      );
      expect(capture.lines.join("")).toBe("Host,Port\nstaging,2222\n");
      expect(await Bun.file(mdPath).exists()).toBe(false);
    } finally {
      capture.restore();
    }
  });

  test("formatPropertyTableInspect uses Bun.inspect.table", () => {
    const out = formatPropertyTableInspect(SAMPLE);
    expect(out).toContain("staging");
    expect(out).toContain("2222");
  });

  test("emitPropertyTableOutput raw writes markdown only", async () => {
    const dir = testTempDir("pt-renderer-raw-");
    const mdPath = join(dir, "out.md");
    const capture = captureStdout();
    try {
      await Effect.runPromise(
        emitPropertyTableOutput(SAMPLE, {
          format: "raw",
          markdownPath: mdPath,
        })
      );
      expect(capture.lines.join("")).toContain("| staging | 2222 |");
      expect(await Bun.file(mdPath).exists()).toBe(false);
    } finally {
      capture.restore();
    }
  });

  test("emitPropertyTableOutput file writes markdown and hints preview", async () => {
    const dir = testTempDir("pt-renderer-file-");
    const mdPath = join(dir, "out.md");
    const stderr: string[] = [];
    const origStderr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderr.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      await Effect.runPromise(
        emitPropertyTableOutput(SAMPLE, {
          format: "file",
          markdownPath: mdPath,
        })
      );
      const text = await Bun.file(mdPath).text();
      expect(text).toContain("# demo.table");
      expect(text).toContain("staging");
      expect(stderr.join("")).toContain(mdPath);
      expect(stderr.join("")).toContain(`Preview: bun ${mdPath}`);
    } finally {
      process.stderr.write = origStderr;
    }
  });

  test("formatPropertyTableJson emits stable payload JSON", () => {
    const out = formatPropertyTableJson(SAMPLE);
    const parsed = JSON.parse(out);
    expect(parsed.title).toBe("demo.table");
    expect(parsed.sourceLabel).toBe("dx.config.toml");
    expect(parsed.columns).toEqual(["Host", "Port"]);
    expect(parsed.rows).toEqual([{ Host: "staging", Port: "2222" }]);
  });

  test("emitPropertyTableOutput json writes payload JSON to stdout", async () => {
    const dir = testTempDir("pt-renderer-json-");
    const mdPath = join(dir, "out.md");
    const capture = captureStdout();
    try {
      await Effect.runPromise(
        emitPropertyTableOutput(SAMPLE, {
          format: "json",
          markdownPath: mdPath,
        })
      );
      const parsed = JSON.parse(capture.lines.join(""));
      expect(parsed.columns).toEqual(["Host", "Port"]);
      expect(parsed.rows).toEqual([{ Host: "staging", Port: "2222" }]);
      expect(await Bun.file(mdPath).exists()).toBe(false);
    } finally {
      capture.restore();
    }
  });
});
