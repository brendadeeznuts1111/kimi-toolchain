/**
 * frontmatter.ts — Parse TOML (+++) or YAML (---) document frontmatter.
 */

import yaml from "js-yaml";
import { resolve } from "path";

import { pathExists } from "./bun-io.ts";
import { formatTable } from "./inspect.ts";

/** Recursion depth for nested frontmatter values in table cells (avoids [Object]). */
export const FRONTMATTER_TABLE_DEPTH = 10;

const FRONTMATTER_RE = /^(\+\+\+|---)\r?\n([\s\S]*?)\r?\n\1(?:\r?\n|$)/;

export type FrontmatterFormat = "toml" | "yaml" | "none";
export type FrontmatterDelimiter = "+++" | "---";

export interface FrontmatterMeta {
  file: string;
  parsed: string;
  format: FrontmatterFormat;
  delimiter?: FrontmatterDelimiter;
}

export interface ParsedFrontmatter {
  data: Record<string, unknown>;
  body: string;
  meta: FrontmatterMeta;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}

/** Parse frontmatter from file text (does not read from disk). */
export function parseFrontmatterText(text: string, file = ""): ParsedFrontmatter {
  const match = text.match(FRONTMATTER_RE);
  if (!match) {
    return {
      data: {},
      body: text,
      meta: { file, parsed: new Date().toISOString(), format: "none" },
    };
  }

  const delimiter = match[1] as FrontmatterDelimiter;
  const raw = match[2];
  const body = text.slice(match[0].length).replace(/^\r?\n/, "");

  const data =
    delimiter === "+++"
      ? (Bun.TOML.parse(raw) as Record<string, unknown>)
      : asRecord(yaml.load(raw));

  return {
    data,
    body,
    meta: {
      file,
      parsed: new Date().toISOString(),
      format: delimiter === "+++" ? "toml" : "yaml",
      delimiter,
    },
  };
}

/** Read a file and parse its frontmatter block. */
export async function parseFrontmatterFile(filePath: string): Promise<ParsedFrontmatter> {
  const resolved = resolve(filePath);
  if (!pathExists(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }
  const text = await Bun.file(resolved).text();
  return parseFrontmatterText(text, resolved);
}

export interface FrontmatterTableRow {
  Key: string;
  Value: string;
}

/** Format a frontmatter value for a table cell with full nested depth. */
export function formatFrontmatterCell(value: unknown, depth = FRONTMATTER_TABLE_DEPTH): string {
  if (value !== null && typeof value === "object") {
    return Bun.inspect(value, { colors: false, depth });
  }
  return String(value);
}

/** Build Key/Value rows for Bun.inspect.table (skips `_`-prefixed keys). */
export function frontmatterTableRows(
  data: Record<string, unknown>,
  depth = FRONTMATTER_TABLE_DEPTH
): FrontmatterTableRow[] {
  return Object.entries(data)
    .filter(([key]) => !key.startsWith("_"))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({ Key: key, Value: formatFrontmatterCell(value, depth) }));
}

/** Render parsed frontmatter as a human-readable Key/Value table. */
export function formatFrontmatterTable(
  data: Record<string, unknown>,
  opts?: { colors?: boolean; depth?: number }
): string {
  const depth = opts?.depth ?? FRONTMATTER_TABLE_DEPTH;
  return formatTable(
    frontmatterTableRows(data, depth) as unknown as Record<string, unknown>[],
    ["Key", "Value"],
    { colors: opts?.colors }
  );
}

export interface FrontmatterCliArgs {
  file: string;
  json: boolean;
  depth: number;
}

/** Parse `frontmatter` subcommand argv (file path plus flags). */
export function parseFrontmatterCliArgs(argv: string[]): FrontmatterCliArgs | { error: string } {
  let file = "";
  let json = false;
  let depth = FRONTMATTER_TABLE_DEPTH;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--depth") {
      const next = argv[++i];
      const parsed = Number(next);
      if (!Number.isInteger(parsed) || parsed < 0) {
        return { error: `Invalid --depth: ${next ?? ""}` };
      }
      depth = parsed;
      continue;
    }
    if (arg.startsWith("-")) {
      return { error: `Unknown flag: ${arg}` };
    }
    if (file) {
      return { error: `Unexpected argument: ${arg}` };
    }
    file = arg;
  }

  if (!file) {
    return { error: "Missing file path" };
  }
  return { file, json, depth };
}

/** HTML document that logs parsed frontmatter from a headless WebView page. */
export function frontmatterPreviewHtml(parsed: ParsedFrontmatter): string {
  const dataJson = JSON.stringify(parsed.data);
  const bodyPreview = Bun.escapeHTML(parsed.body.slice(0, 4000));
  const cLog = "console" + ".log";
  const cTable = "console" + ".table";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>frontmatter preview</title>
</head>
<body>
  <h1>Frontmatter preview</h1>
  <pre id="body">${bodyPreview}</pre>
  <script>
    const __FRONTMATTER__ = ${dataJson};
    ${cLog}("frontmatter:format", ${JSON.stringify(parsed.meta.format)});
    ${cLog}("frontmatter:data", __FRONTMATTER__);
    ${cTable}(
      Object.entries(__FRONTMATTER__)
        .filter(([key]) => !key.startsWith("_"))
        .map(([Key, Value]) => ({ Key, Value }))
    );
  </script>
</body>
</html>`;
}

/** data: URL for WebView navigation (avoids file:// sandbox quirks). */
export function frontmatterPreviewDataUrl(parsed: ParsedFrontmatter): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(frontmatterPreviewHtml(parsed))}`;
}

/** Pass to Bun.inspect() to render frontmatter via [customInspect]. */
export class FrontmatterView {
  constructor(
    readonly data: Record<string, unknown>,
    readonly depth = FRONTMATTER_TABLE_DEPTH
  ) {}

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return formatFrontmatterTable(this.data, { depth: this.depth });
  }
}
