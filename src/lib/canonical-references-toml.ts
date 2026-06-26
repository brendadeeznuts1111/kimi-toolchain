/**
 * TOML SSOT helpers for canonical-references.toml — parse, serialize, and codegen.
 */

import { join } from "path";
import {
  CANONICAL_REFERENCES_SCHEMA_VERSION,
  type EcosystemReference,
  type LocalDocReference,
  type RepoReference,
} from "./canonical-references-data.ts";
import {
  lintCanonicalReferencesLinkTables,
  lintManifestBunNative,
} from "./canonical-references.ts";

export const CANONICAL_REFERENCES_TOML_FILENAME = "canonical-references.toml";

export interface CanonicalReferencesTomlSource {
  manifest: { schemaVersion: number };
  ecosystem: EcosystemReference[];
  localDocs: LocalDocReference[];
  repos: RepoReference[];
}

export function repoCanonicalReferencesTomlPath(projectRoot: string): string {
  return join(projectRoot, CANONICAL_REFERENCES_TOML_FILENAME);
}

export function parseCanonicalReferencesToml(text: string): CanonicalReferencesTomlSource {
  const raw = Bun.TOML.parse(text) as Record<string, unknown>;
  return normalizeTomlSource(raw);
}

export function normalizeTomlSource(raw: Record<string, unknown>): CanonicalReferencesTomlSource {
  const manifest = raw.manifest;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("canonical-references.toml: [manifest] table required");
  }
  const schemaVersion = (manifest as { schemaVersion?: unknown }).schemaVersion;
  if (typeof schemaVersion !== "number") {
    throw new Error("canonical-references.toml: manifest.schemaVersion must be a number");
  }

  for (const key of ["ecosystem", "localDocs", "repos"] as const) {
    if (!Array.isArray(raw[key])) {
      throw new Error(`canonical-references.toml: [[${key}]] array required`);
    }
  }

  return {
    manifest: { schemaVersion },
    ecosystem: raw.ecosystem as EcosystemReference[],
    localDocs: raw.localDocs as LocalDocReference[],
    repos: raw.repos as RepoReference[],
  };
}

/** Bun-native structural validation for a raw canonical-references.toml string. */
export function lintCanonicalReferencesToml(text: string): string[] {
  const source = parseCanonicalReferencesToml(text);
  return [
    ...lintManifestBunNative({
      schemaVersion: source.manifest.schemaVersion,
      ecosystem: source.ecosystem,
      localDocs: source.localDocs,
      repos: source.repos,
    }),
    ...lintCanonicalReferencesLinkTables({
      ecosystem: source.ecosystem,
      localDocs: source.localDocs,
      repos: source.repos,
    }),
  ];
}

const ECOSYSTEM_FIELD_ORDER = [
  "id",
  "name",
  "kind",
  "homepage",
  "docs",
  "package",
  "usage",
  "minVersion",
  "install",
  "repoId",
  "noRepo",
  "status",
] as const;

const LOCAL_DOC_FIELD_ORDER = [
  "id",
  "repoPath",
  "runtimePath",
  "purpose",
  "cursorCanvas",
  "canvasId",
  "canvasPage",
  "canvasVersion",
  "canvasLayer",
  "canvasOpenWhen",
  "canvasReadOrder",
  "canvasInfluences",
] as const;

const REPO_FIELD_ORDER = [
  "id",
  "name",
  "url",
  "description",
  "defaultBranch",
  "ciStatusUrl",
  "clonePath",
  "provides",
  "role",
  "language",
  "frameworks",
  "expectedPackageName",
] as const;

function escapeTomlBasicString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\t/g, "\\t");
}

function needsMultilineString(value: string): boolean {
  return value.includes("\n") || value.includes('"') || value.includes("\\");
}

function formatTomlString(value: string): string {
  if (needsMultilineString(value)) {
    return `"""\n${value}\n"""`;
  }
  return `"${escapeTomlBasicString(value)}"`;
}

function formatTomlValue(value: unknown): string {
  if (typeof value === "string") return formatTomlString(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    const items = value.map((item) => formatTomlValue(item)).join(", ");
    return `[${items}]`;
  }
  throw new Error(`unsupported TOML value type: ${typeof value}`);
}

function formatTomlTableRow(
  tableName: string,
  item: Record<string, unknown>,
  fieldOrder: readonly string[]
): string {
  const lines = [`[[${tableName}]]`];
  const keys = new Set(Object.keys(item));
  for (const key of fieldOrder) {
    if (!keys.has(key)) continue;
    const value = item[key];
    if (value === undefined) continue;
    lines.push(`${key} = ${formatTomlValue(value)}`);
  }
  for (const key of [...keys].sort()) {
    if ((fieldOrder as readonly string[]).includes(key)) continue;
    const value = item[key];
    if (value === undefined) continue;
    lines.push(`${key} = ${formatTomlValue(value)}`);
  }
  return lines.join("\n");
}

/** Serialize link tables to canonical-references.toml text. */
export function serializeCanonicalReferencesToml(source: CanonicalReferencesTomlSource): string {
  const lines = [
    "# Canonical ecosystem and documentation links — edit here; run `bun run references:generate`.",
    "",
    "[manifest]",
    `schemaVersion = ${source.manifest.schemaVersion}`,
    "",
  ];

  for (const item of source.ecosystem) {
    lines.push(
      formatTomlTableRow("ecosystem", item as Record<string, unknown>, ECOSYSTEM_FIELD_ORDER),
      ""
    );
  }
  for (const item of source.localDocs) {
    lines.push(
      formatTomlTableRow("localDocs", item as Record<string, unknown>, LOCAL_DOC_FIELD_ORDER),
      ""
    );
  }
  for (const item of source.repos) {
    lines.push(formatTomlTableRow("repos", item as Record<string, unknown>, REPO_FIELD_ORDER), "");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function formatTsObject(item: Record<string, unknown>, indent = "  "): string {
  const lines = ["{"];
  for (const [key, value] of Object.entries(item)) {
    if (value === undefined) continue;
    lines.push(`${indent}  ${JSON.stringify(key)}: ${JSON.stringify(value)},`);
  }
  lines.push(`${indent}}`);
  return lines.join("\n");
}

export const CANONICAL_REFERENCES_ARRAYS_MARKER =
  "// Auto-generated arrays from canonical-references.toml. Do not edit.";

export function extractCanonicalReferencesTypesPrefix(existing: string): string {
  const idx = existing.indexOf(CANONICAL_REFERENCES_ARRAYS_MARKER);
  if (idx < 0) {
    throw new Error(
      `missing ${CANONICAL_REFERENCES_ARRAYS_MARKER} in canonical-references-data.ts`
    );
  }
  return existing.slice(0, idx).trimEnd();
}

/** Generate src/lib/canonical-references-data.ts source from parsed TOML. */
export function generateCanonicalReferencesDataTs(
  source: CanonicalReferencesTomlSource,
  typesPrefix: string
): string {
  const blocks: string[] = [typesPrefix, "", CANONICAL_REFERENCES_ARRAYS_MARKER, ""];

  const tables: [string, unknown[], string][] = [
    ["ECOSYSTEM_REFERENCES", source.ecosystem, "EcosystemReference"],
    ["LOCAL_DOC_REFERENCES", source.localDocs, "LocalDocReference"],
    ["REPO_REFERENCES", source.repos, "RepoReference"],
  ];

  for (const [name, items, typeName] of tables) {
    blocks.push(`export const ${name}: readonly ${typeName}[] = [`);
    for (const item of items) {
      blocks.push(`${formatTsObject(item as Record<string, unknown>)},`);
    }
    blocks.push("];", "");
  }

  return `${blocks.join("\n").trimEnd()}\n`;
}

export function defaultTomlSchemaVersion(): number {
  return CANONICAL_REFERENCES_SCHEMA_VERSION;
}
