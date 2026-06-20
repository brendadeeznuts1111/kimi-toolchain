/**
 * Row/column validation for dx:table extract (--schema).
 */

import { resolve } from "path";
import { TOML } from "bun";
import { pathExists } from "./bun-io.ts";
import { emptyToEmDash } from "./markdown-table.ts";

export type TableColumnSchemaType = "string" | "number" | "integer";

export interface TableColumnSchemaRule {
  type?: TableColumnSchemaType;
  pattern?: string;
  enum?: readonly (string | number)[];
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  /** Boolean expression; receives cell `value` as a string. */
  custom?: string;
}

export interface TableSchema {
  required: string[];
  columns: Record<string, TableColumnSchemaRule>;
}

export interface TableSchemaViolation {
  row: number;
  column: string;
  value: string;
  message: string;
}

const EMPTY = emptyToEmDash(null);

function isBlankCell(value: string): boolean {
  return value.trim() === "" || value === EMPTY;
}

function readNumberField(raw: Record<string, unknown>, key: string): number | undefined {
  const value = raw[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseColumnRule(ruleRaw: Record<string, unknown>): TableColumnSchemaRule {
  const parsed: TableColumnSchemaRule = {};
  if (ruleRaw.type === "string" || ruleRaw.type === "number" || ruleRaw.type === "integer") {
    parsed.type = ruleRaw.type;
  }
  if (typeof ruleRaw.pattern === "string") parsed.pattern = ruleRaw.pattern;
  if (Array.isArray(ruleRaw.enum)) {
    parsed.enum = ruleRaw.enum.filter(
      (item): item is string | number => typeof item === "string" || typeof item === "number"
    );
  }
  const minLength = readNumberField(ruleRaw, "minLength");
  if (minLength !== undefined) parsed.minLength = minLength;
  const maxLength = readNumberField(ruleRaw, "maxLength");
  if (maxLength !== undefined) parsed.maxLength = maxLength;
  const min = readNumberField(ruleRaw, "min");
  if (min !== undefined) parsed.min = min;
  const max = readNumberField(ruleRaw, "max");
  if (max !== undefined) parsed.max = max;
  if (typeof ruleRaw.custom === "string") parsed.custom = ruleRaw.custom;
  return parsed;
}

function parseSchemaObject(raw: Record<string, unknown>): TableSchema {
  const required = Array.isArray(raw.required)
    ? raw.required.filter((item): item is string => typeof item === "string")
    : [];

  const columns: Record<string, TableColumnSchemaRule> = {};
  const columnsBlock = raw.columns;
  if (columnsBlock && typeof columnsBlock === "object" && !Array.isArray(columnsBlock)) {
    for (const [name, ruleRaw] of Object.entries(columnsBlock as Record<string, unknown>)) {
      if (!ruleRaw || typeof ruleRaw !== "object" || Array.isArray(ruleRaw)) continue;
      columns[name] = parseColumnRule(ruleRaw as Record<string, unknown>);
    }
  }

  return { required, columns };
}

/** Load schema from `.toml` or `.json`. */
export async function loadTableSchema(
  projectRoot: string,
  schemaPath: string
): Promise<TableSchema> {
  const absolute = resolve(projectRoot, schemaPath);
  if (!pathExists(absolute)) {
    throw new Error(`Schema file not found: ${schemaPath}`);
  }
  const text = await Bun.file(absolute).text();
  const raw = absolute.endsWith(".json")
    ? (JSON.parse(text) as Record<string, unknown>)
    : (TOML.parse(text) as Record<string, unknown>);
  return parseSchemaObject(raw);
}

function validateCellValue(
  column: string,
  value: string,
  rule: TableColumnSchemaRule
): string | null {
  if (isBlankCell(value)) return null;

  if (rule.type === "number") {
    if (!/^-?\d+(\.\d+)?$/.test(value.trim())) {
      return `expected number, got ${JSON.stringify(value)}`;
    }
  } else if (rule.type === "integer") {
    if (!/^-?\d+$/.test(value.trim())) {
      return `expected integer, got ${JSON.stringify(value)}`;
    }
  }

  if (rule.pattern) {
    let re: RegExp;
    try {
      re = new RegExp(rule.pattern);
    } catch {
      return `invalid schema pattern for ${column}: ${rule.pattern}`;
    }
    if (!re.test(value)) {
      return `pattern ${rule.pattern} mismatch`;
    }
  }

  if (rule.enum && rule.enum.length > 0) {
    const allowed = rule.enum.map(String);
    if (!allowed.includes(value)) {
      return `enum mismatch: expected one of [${allowed.join(", ")}], got ${JSON.stringify(value)}`;
    }
  }

  if (rule.minLength !== undefined && value.length < rule.minLength) {
    return `minLength ${rule.minLength} not met (length ${value.length})`;
  }
  if (rule.maxLength !== undefined && value.length > rule.maxLength) {
    return `maxLength ${rule.maxLength} exceeded (length ${value.length})`;
  }

  if (rule.min !== undefined || rule.max !== undefined) {
    const numeric = Number(value.trim());
    if (!Number.isFinite(numeric)) {
      return `expected numeric value for min/max check, got ${JSON.stringify(value)}`;
    }
    if (rule.min !== undefined && numeric < rule.min) {
      return `min ${rule.min} not met (value ${numeric})`;
    }
    if (rule.max !== undefined && numeric > rule.max) {
      return `max ${rule.max} exceeded (value ${numeric})`;
    }
  }

  if (rule.custom) {
    try {
      const fn = new Function("value", `"use strict"; return (${rule.custom});`);
      if (!fn(value)) {
        return `custom expression failed: ${rule.custom}`;
      }
    } catch (err) {
      return `custom expression error: ${err instanceof Error ? err.message : Bun.inspect(err)}`;
    }
  }

  return null;
}

/** Validate prepared table rows; returns all violations (empty = pass). */
export function validateTableAgainstSchema(
  columns: readonly string[],
  rows: readonly Record<string, string>[],
  schema: TableSchema
): TableSchemaViolation[] {
  const violations: TableSchemaViolation[] = [];
  const columnSet = new Set(columns);

  for (const col of schema.required) {
    if (!columnSet.has(col)) {
      violations.push({
        row: 0,
        column: col,
        value: "",
        message: `missing required column in table output`,
      });
    }
  }

  const ruledColumns = new Set([...schema.required, ...Object.keys(schema.columns)]);

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex]!;
    const rowNum = rowIndex + 1;

    for (const col of ruledColumns) {
      if (!columnSet.has(col)) continue;
      const value = row[col] ?? "";
      const rule = schema.columns[col] ?? {};
      const isRequired = schema.required.includes(col);

      if (isRequired && isBlankCell(value)) {
        violations.push({
          row: rowNum,
          column: col,
          value,
          message: "required value is empty",
        });
        continue;
      }

      if (isBlankCell(value)) continue;

      const cellError = validateCellValue(col, value, rule);
      if (cellError) {
        violations.push({
          row: rowNum,
          column: col,
          value,
          message: cellError,
        });
      }
    }
  }

  return violations;
}

export function formatTableSchemaViolations(
  schemaPath: string,
  violations: readonly TableSchemaViolation[]
): string {
  const lines = violations.map((v) =>
    v.row === 0
      ? `schema ${schemaPath}: column ${v.column}: ${v.message}`
      : `schema ${schemaPath}: row ${v.row} column ${v.column}: ${v.message} (value=${JSON.stringify(v.value)})`
  );
  return lines.join("\n");
}
