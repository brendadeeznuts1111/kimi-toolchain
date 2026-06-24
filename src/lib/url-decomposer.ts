/**
 * Decompose URL-shaped table cells into URLPattern / URL component columns.
 *
 * Uses `new URL()` for parsing (same decomposition as URLPattern parts).
 * @see https://bun.com/blog/bun-v1.3.12 — URLPattern.test/exec performance
 * @see {@link BUN_PUNYCODE_TO_ASCII_DOC_URL} — Full hostname Unicode → ASCII (`xn--` labels).
 * @see {@link BUN_PUNYCODE_ENCODE_DOC_URL} — Single label Unicode → punycode body (no `xn--`).
 * @see {@link BUN_PUNYCODE_DECODE_DOC_URL} — Punycode body → Unicode label.
 */

import { decode, encode, toASCII } from "node:punycode"; // @bun-native-exempt:banned-import — Bun docs reference punycode shim
import { domainToUnicode } from "node:url"; // @bun-native-exempt:banned-import — Bun docs reference punycode encode/decode hooks
import { emptyToEmDash, type MarkdownTableColumnSpec } from "./markdown-table.ts";

export const BUN_PUNYCODE_TO_ASCII_DOC_URL =
  "https://bun.sh/reference/node/punycode/toASCII#node:punycode.toASCII";
export const BUN_PUNYCODE_ENCODE_DOC_URL =
  "https://bun.sh/reference/node/punycode/encode#node:punycode.encode";
export const BUN_PUNYCODE_DECODE_DOC_URL = "https://bun.sh/reference/node/punycode/decode";
export const BUN_DOMAIN_TO_UNICODE_DOC_URL =
  "https://bun.sh/reference/node/url/domainToUnicode#node:url.domainToUnicode";

export const URL_DECOMPOSE_FIELDS = [
  "protocol",
  "hostname",
  "port",
  "pathname",
  "search",
  "hash",
] as const;

export type UrlDecomposeField = (typeof URL_DECOMPOSE_FIELDS)[number];

export interface UrlDecomposedParts {
  protocol: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
}

/** Absolute URL scheme prefix (http, https, ws, wss, ftp). */
export const ABSOLUTE_URL_SCHEME_RE = /^(https?|wss?|ftp):\/\//i;

const FIELD_KINDS: Record<UrlDecomposeField, MarkdownTableColumnSpec["kind"]> = {
  protocol: "text",
  hostname: "text",
  port: "number",
  pathname: "path",
  search: "text",
  hash: "text",
};

const URL_LIKE_COLUMN_NAMES = new Set(["url", "endpoint", "href", "baseurl", "uri", "link"]);
const PUNYCODE_LABEL_PREFIX = "xn--";

/** Column name for a decomposed part: `url` + `protocol` → `url_protocol`. */
export function decomposedColumnName(urlColumn: string, field: UrlDecomposeField): string {
  return `${urlColumn}_${field}`;
}

/** True when value has an absolute URL scheme and parses. */
export function looksLikeAbsoluteUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed === emptyToEmDash(null)) return false;
  if (!ABSOLUTE_URL_SCHEME_RE.test(trimmed)) return false;
  if (typeof URL.canParse === "function") return URL.canParse(trimmed);
  try {
    new URL(trimmed);
    return true;
  } catch {
    return false;
  }
}

/** Canonical ASCII hostname for URL table keys, including IDN Punycode labels. */
export function normalizeHostnameAscii(hostname: string): string {
  return toASCII(hostname.trim().toLowerCase());
}

/** Decode a full ASCII hostname (with `xn--` labels) back to Unicode via `node:url`. */
export function decodeHostnameUnicode(hostname: string): string {
  return domainToUnicode(hostname.trim().toLowerCase());
}

/**
 * Encode one Unicode hostname label to a punycode body (no `xn--` prefix).
 * Pair with {@link decodePunycodeLabel} — use {@link normalizeHostnameAscii} for full hostnames.
 */
export function encodePunycodeLabel(label: string): string {
  return encode(label);
}

/** Decode a punycode body (no `xn--`) back to Unicode. */
export function decodePunycodeLabel(body: string): string {
  return decode(body);
}

/** Build `xn--` + body when a label contains non-ASCII; pure ASCII labels pass through. */
export function punycodeLabelToAsciiLabel(label: string): string {
  // eslint-disable-next-line no-control-regex
  if (!/[^\u0000-\u007F]/.test(label)) return label;
  return `${PUNYCODE_LABEL_PREFIX}${encodePunycodeLabel(label)}`;
}

/**
 * Decode `xn--` hostname labels for display while leaving ordinary labels unchanged.
 * `node:punycode.decode()` expects the raw label body, so the prefix is stripped per label.
 */
export function decodePunycodeHostname(hostname: string): string {
  return hostname
    .split(".")
    .map((label) => {
      if (!label.toLowerCase().startsWith(PUNYCODE_LABEL_PREFIX)) return label;
      try {
        return decode(label.slice(PUNYCODE_LABEL_PREFIX.length));
      } catch {
        return label;
      }
    })
    .join(".");
}

/** @deprecated Use looksLikeAbsoluteUrl — kept for tests. */
export function isParseableUrl(value: string): boolean {
  return looksLikeAbsoluteUrl(value);
}

/** Split a URL into component parts (empty port/search/hash → em dash). */
export function decomposeUrl(value: string): UrlDecomposedParts {
  const url = new URL(value.trim());
  return {
    protocol: url.protocol,
    hostname: normalizeHostnameAscii(url.hostname),
    port: emptyToEmDash(url.port),
    pathname: url.pathname,
    search: emptyToEmDash(url.search),
    hash: emptyToEmDash(url.hash),
  };
}

function isUrlLikeColumnName(name: string): boolean {
  return URL_LIKE_COLUMN_NAMES.has(name.toLowerCase());
}

function columnSpecForField(urlColumn: string, field: UrlDecomposeField): MarkdownTableColumnSpec {
  return { name: decomposedColumnName(urlColumn, field), kind: FIELD_KINDS[field] };
}

/**
 * Columns to decompose: url-like names with ≥1 absolute URL, or every non-empty cell is absolute.
 */
export function detectUrlColumns(
  columns: readonly string[],
  rows: readonly Record<string, string>[]
): string[] {
  const found: string[] = [];
  for (const col of columns) {
    const values = rows
      .map((row) => row[col] ?? "")
      .filter((cell) => cell !== "" && cell !== emptyToEmDash(null));

    if (isUrlLikeColumnName(col)) {
      if (values.some(looksLikeAbsoluteUrl)) found.push(col);
      continue;
    }
    if (values.length > 0 && values.every(looksLikeAbsoluteUrl)) {
      found.push(col);
    }
  }
  return found;
}

export interface ApplyUrlDecompositionInput {
  columns: readonly string[];
  rows: readonly Record<string, string>[];
  columnSpecs?: readonly MarkdownTableColumnSpec[];
  /** Omit original URL column(s) (--no-source-url / --hide-source-url). */
  noSourceUrl?: boolean;
}

export interface ApplyUrlDecompositionResult {
  columns: string[];
  rows: Record<string, string>[];
  columnSpecs?: readonly MarkdownTableColumnSpec[];
}

/**
 * Append url_protocol, url_hostname, … immediately after each URL column.
 * Invalid per-row URLs keep the source cell; decomposed cells are em dash.
 */
export function applyUrlDecomposition(
  input: ApplyUrlDecompositionInput
): ApplyUrlDecompositionResult {
  const urlColumns = detectUrlColumns(input.columns, input.rows);
  if (urlColumns.length === 0) {
    return {
      columns: [...input.columns],
      rows: input.rows.map((row) => ({ ...row })),
      columnSpecs: input.columnSpecs,
    };
  }

  const urlColumnSet = new Set(urlColumns);
  const newColumns: string[] = [];
  const newSpecs: MarkdownTableColumnSpec[] = [];

  for (const col of input.columns) {
    if (!urlColumnSet.has(col)) {
      newColumns.push(col);
      const spec = input.columnSpecs?.find((s) => s.name === col);
      if (spec) newSpecs.push(spec);
      continue;
    }

    if (!input.noSourceUrl) {
      newColumns.push(col);
      const spec = input.columnSpecs?.find((s) => s.name === col);
      if (spec) newSpecs.push(spec);
    }

    for (const field of URL_DECOMPOSE_FIELDS) {
      const name = decomposedColumnName(col, field);
      newColumns.push(name);
      newSpecs.push(columnSpecForField(col, field));
    }
  }

  const newRows = input.rows.map((row) => {
    const next = { ...row };
    for (const urlCol of urlColumns) {
      const raw = row[urlCol] ?? "";
      if (!looksLikeAbsoluteUrl(raw)) {
        for (const field of URL_DECOMPOSE_FIELDS) {
          next[decomposedColumnName(urlCol, field)] = emptyToEmDash(null);
        }
        continue;
      }
      const parts = decomposeUrl(raw);
      for (const field of URL_DECOMPOSE_FIELDS) {
        next[decomposedColumnName(urlCol, field)] = parts[field];
      }
    }
    if (input.noSourceUrl) {
      for (const urlCol of urlColumns) {
        delete next[urlCol];
      }
    }
    return next;
  });

  return {
    columns: newColumns,
    rows: newRows,
    columnSpecs: newSpecs.length > 0 ? newSpecs : input.columnSpecs,
  };
}
