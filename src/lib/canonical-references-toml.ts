/**
 * TOML SSOT helpers for canonical-references.toml — parse, serialize, and codegen.
 */

import { join } from "path";

export const CANONICAL_REFERENCES_SCHEMA_VERSION = 1;

export type ReferenceKind =
  | "runtime"
  | "library"
  | "product"
  | "platform"
  | "docs"
  | "repo"
  | "mcp";

export type EcosystemReferenceStatus = "active" | "deprecated" | "experimental" | "external-fork";

export interface EcosystemReference {
  id: string;
  name: string;
  kind: ReferenceKind;
  homepage: string;
  docs: string;
  package?: string;
  usage: string;
  minVersion?: string;
  install?: string;
  repoId?: string;
  noRepo?: true;
  status?: EcosystemReferenceStatus;
}

export interface LocalDocReference {
  id: string;
  repoPath: string;
  runtimePath: string;
  purpose: string;
  cursorCanvas?: string;
  canvasPage?: string;
  canvasId?: string;
  canvasVersion?: string;
  canvasLayer?: string;
  canvasOpenWhen?: string;
  canvasReadOrder?: number;
  canvasInfluences?: readonly string[];
}

export type RepoRole = "upstream" | "tool" | "dependency";
export type RepoLanguage = "typescript" | "rust" | "javascript";
export type RepoFramework = "bun" | "node" | "effect" | "oxc";

export interface RepoReference {
  id: string;
  name: string;
  url: string;
  description?: string;
  defaultBranch?: string;
  ciStatusUrl?: string;
  clonePath?: string;
  provides?: readonly string[];
  role?: RepoRole;
  language?: RepoLanguage;
  frameworks?: readonly RepoFramework[];
  expectedPackageName?: string;
}

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
      formatTomlTableRow(
        "ecosystem",
        item as unknown as Record<string, unknown>,
        ECOSYSTEM_FIELD_ORDER
      ),
      ""
    );
  }
  for (const item of source.localDocs) {
    lines.push(
      formatTomlTableRow(
        "localDocs",
        item as unknown as Record<string, unknown>,
        LOCAL_DOC_FIELD_ORDER
      ),
      ""
    );
  }
  for (const item of source.repos) {
    lines.push(
      formatTomlTableRow("repos", item as unknown as Record<string, unknown>, REPO_FIELD_ORDER),
      ""
    );
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

/** Type definitions prepended to generated canonical-references-data.ts. */
export function canonicalReferencesTypeDefinitions(): string {
  return `/**
 * Canonical reference type definitions and constants.
 *
 * Prepended to auto-generated canonical-references-data.ts so consumers share
 * types without a separate shard or circular imports through canonical-references.ts.
 */

export const CANONICAL_REFERENCES_SCHEMA_VERSION = 1;

export type ReferenceKind =
  | "runtime"
  | "library"
  | "product"
  | "platform"
  | "docs"
  | "repo"
  | "mcp";

export type EcosystemReferenceStatus = "active" | "deprecated" | "experimental" | "external-fork";

export interface EcosystemReference {
  id: string;
  name: string;
  kind: ReferenceKind;
  homepage: string;
  docs: string;
  /** npm package name when applicable */
  package?: string;
  /** When agents should reach for this stack */
  usage: string;
  minVersion?: string;
  install?: string;
  /** Corresponding REPO_REFERENCES id. Falls back to convention \`<id>-upstream\` when absent. */
  repoId?: string;
  /** Set true when no repo entry is expected (e.g. platform services, hosted MCPs). */
  noRepo?: true;
  /** Lifecycle status — agents should avoid deprecated entries. Defaults to "active" when absent. */
  status?: EcosystemReferenceStatus;
}

/**
 * Manifest index row for a local documentation file.
 * These are path pointers and human-readable purposes —
 * NOT \`dx.config.toml\` keys. Boundary semantics (toolchain vs Herdr,
 * global vs project) live in the doc content at id \`namespace\`.
 */
export interface LocalDocReference {
  id: string;
  repoPath: string;
  runtimePath: string;
  purpose: string;
  /** Repo-relative Cursor Canvas path; IDE-only pointer — not synced to ~/.kimi-code/ */
  cursorCanvas?: string;
  /** Canvas display page name (e.g. "Doc links"). Matches CANVAS_ROUTING.page. */
  canvasPage?: string;
  /** Canvas self-identifier (e.g. "doc-links-and-see-ladder"). Matches CANVAS_ROUTING.id. */
  canvasId?: string;
  /** Canvas version string (e.g. "0.1.0"). From CANVAS_ROUTING.version. */
  canvasVersion?: string;
  /** Canvas layer label (e.g. "Doc URL lint"). From CANVAS_ROUTING.layer. */
  canvasLayer?: string;
  /** When to open hint (e.g. "@see ladder · docs/references"). From CANVAS_ROUTING.openWhen. */
  canvasOpenWhen?: string;
  /** Read-order grouping (1=Hub, 2=Config/Namespace, 3=Cross-ref, 4=Scaffold, 5-6=Herdr). */
  canvasReadOrder?: number;
  /** examples/dashboard card ids (\`card-*\`) this canvas influences — v5.4 wiring SSOT */
  canvasInfluences?: readonly string[];
}

export type RepoRole = "upstream" | "tool" | "dependency";

export type RepoLanguage = "typescript" | "rust" | "javascript";

export type RepoFramework = "bun" | "node" | "effect" | "oxc";

export interface RepoReference {
  id: string;
  name: string;
  url: string;
  description?: string;
  defaultBranch?: string;
  ciStatusUrl?: string;
  clonePath?: string;
  /** EcosystemReference ids this repository is the canonical source for. */
  provides?: readonly string[];
  role?: RepoRole;
  language?: RepoLanguage;
  frameworks?: readonly RepoFramework[];
  /** Expected package.json \`name\` when clonePath is validated. Defaults to \`name\`. */
  expectedPackageName?: string;
}

export interface CanonicalReferencesManifest {
  schemaVersion: typeof CANONICAL_REFERENCES_SCHEMA_VERSION;
  generatedAt: string;
  toolchainVersion: string;
  ecosystem: EcosystemReference[];
  localDocs: LocalDocReference[];
  repos: RepoReference[];
}`;
}

/** Generate src/lib/canonical-references-data.ts source from parsed TOML. */
export function generateCanonicalReferencesDataTs(source: CanonicalReferencesTomlSource): string {
  const blocks: string[] = [
    canonicalReferencesTypeDefinitions(),
    "",
    "// Auto-generated arrays from canonical-references.toml. Do not edit.",
    "",
  ];

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
