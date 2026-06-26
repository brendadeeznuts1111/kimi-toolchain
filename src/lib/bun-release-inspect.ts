/**
 * Bun.inspect.table / console.table formatters for the release registry.
 *
 * `console.table` and `Bun.inspect.table` share the same native TablePrinter.
 * Use `{ depth: 0 }` so nested cell values match console.table (not max_depth 5).
 */

import { inspect } from "bun";
import type { ReleaseHistoryRow } from "./bun-release-registry.ts";

/** Breaking-focused `release:info` columns. */
export const RELEASE_BREAKING_PROPERTIES = [
  "version",
  "role",
  "breaking",
  "breakingCount",
] as const;

/** Default CLI / doctor columns — compact provenance view. */
export const RELEASE_HISTORY_SUMMARY_PROPERTIES = [
  "version",
  "role",
  "tag",
  "hashShort",
  "author",
  "breaking",
  "blogUrl",
] as const;

/** Full provenance columns (all {@link ReleaseHistoryRow} fields). */
export const RELEASE_HISTORY_FULL_PROPERTIES = [
  "version",
  "role",
  "tag",
  "hash",
  "hashShort",
  "commitUrl",
  "url",
  "blogUrl",
  "blogPublished",
  "author",
  "breaking",
  "breakingCount",
] as const;

/** TablePrinter defaults — depth 0 mirrors console.table cell rendering. */
export const RELEASE_TABLE_PRINTER_OPTS = {
  depth: 0,
  sorted: true,
  colors: false,
} as const;

export type ResolveReleaseTablePropertiesOptions = {
  breaking?: boolean;
  summary?: boolean;
};

/**
 * Normalize CLI `--properties` against release table presets.
 *
 * When `breaking` is requested (via `--breaking` or `--properties …,breaking`),
 * expands to {@link RELEASE_BREAKING_PROPERTIES} and preserves any extra columns.
 */
export function resolveReleaseTableProperties(
  properties: readonly string[] | undefined,
  options: ResolveReleaseTablePropertiesOptions = {}
): readonly string[] | undefined {
  if (options.breaking && !properties) {
    return RELEASE_BREAKING_PROPERTIES;
  }
  if (options.summary && !properties) {
    return RELEASE_HISTORY_SUMMARY_PROPERTIES;
  }
  if (properties?.includes("breaking")) {
    const preset = new Set<string>(RELEASE_BREAKING_PROPERTIES);
    const extras = properties.filter((p) => !preset.has(p));
    return [...RELEASE_BREAKING_PROPERTIES, ...extras];
  }
  return properties;
}

export type ReleaseHistoryTableOptions = {
  colors?: boolean;
  sorted?: boolean;
  /** Cell inspect depth — default 0 (console.table parity). */
  depth?: number;
};

function tableOptions(opts: ReleaseHistoryTableOptions = {}) {
  return {
    depth: opts.depth ?? RELEASE_TABLE_PRINTER_OPTS.depth,
    colors: opts.colors ?? RELEASE_TABLE_PRINTER_OPTS.colors,
    sorted: opts.sorted ?? RELEASE_TABLE_PRINTER_OPTS.sorted,
  };
}

/**
 * Render tabular data in-process (no subprocess) using the shared TablePrinter.
 *
 * Differences mirrored from Bun's console.table tests:
 * - Non-object first arg: console.table logs; inspect.table returns "".
 *   This helper follows console.table (string raw, else inspected + newline).
 * - Objects: always passes `{ depth: 0 }` unless overridden.
 */
export function renderReleaseTable(
  data: unknown,
  properties?: readonly string[],
  opts: ReleaseHistoryTableOptions = {}
): string {
  if (typeof data !== "object" || data === null) {
    return typeof data === "string" ? data : `${inspect(data)}\n`;
  }
  const options = tableOptions(opts);
  if (properties === undefined) {
    return inspect.table(data, options);
  }
  return inspect.table(data, [...properties], options);
}

function isTableInput(rows: unknown): rows is ReleaseHistoryRow[] {
  return Array.isArray(rows) && rows.length > 0 && typeof rows[0] === "object" && rows[0] !== null;
}

/**
 * Format release history rows with `inspect.table`.
 * Returns `""` for empty or non-tabular inputs (matches Bun.inspect.table guard behavior).
 */
export function formatReleaseHistoryTable(
  rows: ReleaseHistoryRow[] | null | undefined,
  properties?: readonly string[],
  opts: ReleaseHistoryTableOptions = {}
): string {
  if (!isTableInput(rows)) return "";
  return renderReleaseTable(rows, properties, opts);
}

/**
 * Format release history rows as a GitHub-flavored markdown table.
 * Returns `""` for empty or non-tabular inputs.
 */
export function formatReleaseHistoryMarkdown(
  rows: ReleaseHistoryRow[] | null | undefined,
  properties?: readonly string[]
): string {
  if (!isTableInput(rows)) return "";
  const first = rows[0];
  if (!first) return "";
  const keys = properties ?? Object.keys(first);
  const header = `| ${keys.join(" | ")} |`;
  const sep = `| ${keys.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => {
    const cells = keys.map((k) => {
      const v = (row as unknown as Record<string, unknown>)[k];
      if (v === undefined || v === null) return "";
      return String(v).replace(/\|/g, "\\|");
    });
    return `| ${cells.join(" | ")} |`;
  });
  return [header, sep, ...body].join("\n");
}
