/**
 * Canonical reference type definitions and constants.
 *
 * Kept in a dedicated module so auto-generated data files and lint utilities
 * can share types without creating circular imports through canonical-references.ts.
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
  /** Corresponding REPO_REFERENCES id. Falls back to convention `<id>-upstream` when absent. */
  repoId?: string;
  /** Set true when no repo entry is expected (e.g. platform services, hosted MCPs). */
  noRepo?: true;
  /** Lifecycle status — agents should avoid deprecated entries. Defaults to "active" when absent. */
  status?: EcosystemReferenceStatus;
}

/**
 * Manifest index row for a local documentation file.
 * These are path pointers and human-readable purposes —
 * NOT `dx.config.toml` keys. Boundary semantics (toolchain vs Herdr,
 * global vs project) live in the doc content at id `namespace`.
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
  /** examples/dashboard card ids (`card-*`) this canvas influences — v5.4 wiring SSOT */
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
  /** Expected package.json `name` when clonePath is validated. Defaults to `name`. */
  expectedPackageName?: string;
}

export interface CanonicalReferencesManifest {
  schemaVersion: typeof CANONICAL_REFERENCES_SCHEMA_VERSION;
  generatedAt: string;
  toolchainVersion: string;
  ecosystem: EcosystemReference[];
  localDocs: LocalDocReference[];
  repos: RepoReference[];
}
