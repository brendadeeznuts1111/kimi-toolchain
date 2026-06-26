/**
 * Property table generator — ts-morph + JSDoc tags + git last-modified.
 */

import { pathExists } from "./bun-io.ts";
import { join, relative, resolve } from "path";
import { $ } from "bun";
import {
  Node,
  Project,
  type PropertyDeclaration,
  type PropertySignature,
  type SourceFile,
} from "ts-morph";
import type { MarkdownTableColumnSpec } from "./markdown-table.ts";

export const PROPERTY_TABLE_COLUMNS = [
  "Property",
  "Type",
  "Default",
  "Required",
  "Description",
  "Min",
  "Max",
  "Example",
  "EnvVar",
  "DeprecatedIn",
  "LastModified",
] as const;

export const PROPERTY_TABLE_COLUMN_SPECS: readonly MarkdownTableColumnSpec[] = [
  { name: "Property", kind: "text" },
  { name: "Type", kind: "text" },
  { name: "Default", kind: "text" },
  { name: "Required", kind: "text" },
  { name: "Description", kind: "text" },
  { name: "Min", kind: "number" },
  { name: "Max", kind: "number" },
  { name: "Example", kind: "text" },
  { name: "EnvVar", kind: "text" },
  { name: "DeprecatedIn", kind: "text" },
  { name: "LastModified", kind: "date" },
];

export type PropertyTableColumn = (typeof PROPERTY_TABLE_COLUMNS)[number];

export type PropertyTableRow = Record<PropertyTableColumn, string>;

export interface PropertyTableResult {
  className: string;
  filePath: string;
  rows: PropertyTableRow[];
}

interface JSDocMeta {
  description: string;
  min: string;
  max: string;
  example: string;
  envVar: string;
  deprecatedIn: string;
  defaultValue: string;
  required: boolean;
}

type MorphProperty = PropertySignature | PropertyDeclaration;

const EMPTY_CELL = "—";

function emptyRow(): PropertyTableRow {
  return Object.fromEntries(
    PROPERTY_TABLE_COLUMNS.map((col) => [col, EMPTY_CELL])
  ) as PropertyTableRow;
}

function displayCell(value: string | undefined | null): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : EMPTY_CELL;
}

function parseJSDoc(member: MorphProperty): JSDocMeta {
  const meta: JSDocMeta = {
    description: "",
    min: "",
    max: "",
    example: "",
    envVar: "",
    deprecatedIn: "",
    defaultValue: "",
    required: false,
  };

  const docs = member.getJsDocs();
  const descriptionParts: string[] = [];

  for (const doc of docs) {
    const desc = doc.getDescription().trim();
    if (desc) descriptionParts.push(desc);

    for (const tag of doc.getTags()) {
      const name = tag.getTagName().toLowerCase();
      const text = tag.getCommentText()?.trim() ?? "";
      switch (name) {
        case "description":
          if (text) meta.description = text;
          break;
        case "min":
          meta.min = text;
          break;
        case "max":
          meta.max = text;
          break;
        case "example":
          meta.example = text;
          break;
        case "envvar":
          meta.envVar = text;
          break;
        case "deprecatedin":
          meta.deprecatedIn = text;
          break;
        case "deprecated":
          if (!meta.deprecatedIn && text) meta.deprecatedIn = text;
          break;
        case "default":
          meta.defaultValue = text;
          break;
        case "required":
          meta.required = true;
          break;
        default:
          break;
      }
    }
  }

  if (!meta.description && descriptionParts.length > 0) {
    meta.description = descriptionParts.join(" ");
  }

  return meta;
}

function isRequired(member: MorphProperty, meta: JSDocMeta): boolean {
  if (meta.required) return true;
  return !member.hasQuestionToken();
}

function readDefault(member: MorphProperty, meta: JSDocMeta): string {
  if (meta.defaultValue) return meta.defaultValue;
  if ("getInitializer" in member && typeof member.getInitializer === "function") {
    const init = member.getInitializer();
    if (init) return init.getText();
  }
  return "";
}

function memberTypeText(member: MorphProperty): string {
  return member.getType().getText(member);
}

const GIT_ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}T[\d:.+-Z]+/;

/** Pull ISO-8601 author date from `git log` stdout (`-L` emits the date on the first line). */
export function parseGitLogTimestamp(gitOutput: string): string {
  const trimmed = gitOutput.trim();
  if (!trimmed) return "";
  const match = trimmed.match(GIT_ISO_TIMESTAMP);
  if (match) return match[0];
  const first = trimmed.split("\n")[0]?.trim() ?? "";
  return GIT_ISO_TIMESTAMP.test(first) ? first : "";
}

/** ISO git timestamp for a source line (file-level fallback when line history is missing). */
export async function gitLastModified(
  projectRoot: string,
  absoluteFile: string,
  line: number
): Promise<string> {
  const rel = relative(projectRoot, absoluteFile);
  const lineProc = await $`git log -1 --format=%aI -L ${line},${line}:${rel}`
    .cwd(projectRoot)
    .quiet()
    .nothrow();
  if (lineProc.exitCode === 0) {
    const iso = parseGitLogTimestamp(lineProc.stdout.toString());
    if (iso) return iso;
  }

  const fileProc = await $`git log -1 --format=%aI -- ${rel}`.cwd(projectRoot).quiet().nothrow();
  if (fileProc.exitCode === 0) {
    return parseGitLogTimestamp(fileProc.stdout.toString());
  }
  return "";
}

function listTypeNames(sourceFile: SourceFile): string[] {
  const names = new Set<string>();
  for (const iface of sourceFile.getInterfaces()) names.add(iface.getName());
  for (const cls of sourceFile.getClasses()) {
    const name = cls.getName();
    if (name) names.add(name);
  }
  for (const alias of sourceFile.getTypeAliases()) names.add(alias.getName());
  return [...names].sort();
}

function collectMembers(
  sourceFile: SourceFile,
  className: string,
  filePath: string
): MorphProperty[] {
  const iface = sourceFile.getInterface(className);
  if (iface) return iface.getProperties();

  const cls = sourceFile.getClass(className);
  if (cls) return cls.getProperties();

  const alias = sourceFile.getTypeAlias(className);
  if (alias) {
    const typeNode = alias.getTypeNode();
    if (typeNode && Node.isTypeLiteral(typeNode)) {
      return typeNode.getMembers().filter(Node.isPropertySignature);
    }
    throw new Error(`Type alias ${className} must be an object type literal`);
  }

  const available = listTypeNames(sourceFile);
  const hint =
    available.length > 0
      ? ` Available types in ${filePath}: ${available.join(", ")}`
      : ` No interfaces, classes, or type aliases found in ${filePath}`;
  throw new Error(`Class or interface not found: ${className}.${hint}`);
}

export async function buildPropertyTable(options: {
  projectRoot: string;
  filePath: string;
  className: string;
  tsConfigFilePath?: string;
  includeLastModified?: boolean;
}): Promise<PropertyTableResult> {
  const absoluteFile = resolve(options.projectRoot, options.filePath);
  if (!pathExists(absoluteFile)) {
    throw new Error(`File not found: ${options.filePath}`);
  }

  const tsConfig = options.tsConfigFilePath ?? join(options.projectRoot, "tsconfig.json");
  const project = new Project({
    tsConfigFilePath: pathExists(tsConfig) ? tsConfig : undefined,
    skipAddingFilesFromTsConfig: !pathExists(tsConfig),
  });

  const sourceFile = project.addSourceFileAtPath(absoluteFile);
  const members = collectMembers(sourceFile, options.className, options.filePath);
  const rows: PropertyTableRow[] = [];

  for (const member of members) {
    const base = emptyRow();
    const meta = parseJSDoc(member);
    const line = member.getStartLineNumber();
    const lastModified =
      options.includeLastModified === false
        ? ""
        : await gitLastModified(options.projectRoot, absoluteFile, line);

    base.Property = member.getName();
    base.Type = memberTypeText(member);
    base.Default = displayCell(readDefault(member, meta));
    base.Required = isRequired(member, meta) ? "yes" : "no";
    base.Description = displayCell(meta.description);
    base.Min = displayCell(meta.min);
    base.Max = displayCell(meta.max);
    base.Example = displayCell(meta.example);
    base.EnvVar = displayCell(meta.envVar);
    base.DeprecatedIn = displayCell(meta.deprecatedIn);
    base.LastModified = displayCell(lastModified);

    rows.push(base);
  }

  return {
    className: options.className,
    filePath: options.filePath,
    rows,
  };
}

export function formatPropertyTableInspect(rows: PropertyTableRow[]): string {
  const plain = rows.map((row) =>
    Object.fromEntries(
      PROPERTY_TABLE_COLUMNS.map((col) => [col, row[col] === EMPTY_CELL ? "" : row[col]])
    )
  );
  return Bun.inspect.table(plain, PROPERTY_TABLE_COLUMNS as string[]);
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|");
}

export function formatPropertyTableMarkdown(
  result: PropertyTableResult,
  options: { columns?: readonly string[] } = {}
): string {
  const columns = options.columns ?? PROPERTY_TABLE_COLUMNS;
  const header = `| ${columns.join(" | ")} |`;
  const sep = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = result.rows
    .map(
      (row) =>
        `| ${columns.map((col) => escapeMarkdownCell(displayCell((row as Record<string, string>)[col]))).join(" | ")} |`
    )
    .join("\n");

  return [
    `# ${result.className}`,
    "",
    `Source: \`${result.filePath}\``,
    "",
    header,
    sep,
    body,
    "",
  ].join("\n");
}
