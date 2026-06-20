/**
 * Canonical ecosystem and documentation links — single source of truth.
 * Generated JSON: canonical-references.json (repo root + ~/.kimi-code/ after sync).
 */

import { join } from "path";
import { pathExists, readText } from "./bun-io.ts";
import { canonicalReferencesPath, homeDir } from "./paths.ts";
import { safeParse } from "./utils.ts";
import { TOOLCHAIN_VERSION } from "./version.ts";
import { stableStringify } from "./build-constants-registry.ts";

export const CANONICAL_REFERENCES_SCHEMA_VERSION = 1;
export const CANONICAL_REFERENCES_FILENAME = "canonical-references.json";

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

/** Authoritative link table — edit here; run `bun run references:generate`. */
export const ECOSYSTEM_REFERENCES: readonly EcosystemReference[] = [
  {
    id: "bun",
    name: "Bun",
    kind: "runtime",
    homepage: "https://bun.sh",
    docs: "https://bun.sh/docs",
    package: "bun",
    usage: "Runtime, test runner, package manager, and native I/O for kimi-toolchain",
    minVersion: "1.4.0",
    noRepo: true,
  },
  {
    id: "effect",
    name: "Effect",
    kind: "library",
    homepage: "https://effect.website",
    docs: "https://effect.website/docs",
    package: "effect",
    usage: "Typed errors, CLI/runtime adapters, and Herdr pane orchestration in src/lib/effect/",
    minVersion: "3.21.3",
    repoId: "effect-upstream",
  },
  {
    id: "kimi-code",
    name: "Kimi Code",
    kind: "product",
    homepage: "https://moonshotai.github.io/kimi-code/",
    docs: "https://moonshotai.github.io/kimi-code/en/reference/kimi-command.html",
    usage: "Official agent CLI (`kimi`), config.toml, sessions, MCP — distinct from `kimi-doctor`",
    install: "https://code.kimi.com/kimi-code/install.sh",
    repoId: "kimi-code-upstream",
  },
  {
    id: "herdr",
    name: "Herdr",
    kind: "product",
    homepage: "https://herdr.dev",
    docs: "https://herdr.dev/docs/",
    usage: "Terminal-native multiplexer; socket API for herdr-pane, herdr-latm, herdr-orchestrator",
    install: "https://herdr.dev/install.sh",
    noRepo: true,
  },
  {
    id: "cloudflare",
    name: "Cloudflare Platform",
    kind: "platform",
    homepage: "https://developers.cloudflare.com/",
    docs: "https://developers.cloudflare.com/workers/",
    usage:
      "Workers, Access, MCP; use kimi-cloudflare-access for API tokens (separate from Wrangler OAuth)",
    noRepo: true,
  },
  {
    id: "cloudflare-mcp",
    name: "Cloudflare MCP",
    kind: "mcp",
    homepage: "https://mcp.cloudflare.com/mcp",
    docs: "https://developers.cloudflare.com/agents/model-context-protocol/mcp-server/",
    usage:
      "Default user MCP `cloudflare-api`; optional docs/bindings/builds/observability endpoints",
    noRepo: true,
  },
  {
    id: "dx",
    name: "DX",
    kind: "product",
    homepage: "https://github.com/brendadeeznuts1111/dx-config",
    docs: "~/.config/dx/AGENTS.md",
    usage:
      "Global Bun dev platform — `dx config`, `dx mcp-status`, `dx.config.toml` herdr/finishWork",
    noRepo: true,
  },
  {
    id: "js-yaml",
    name: "js-yaml",
    kind: "library",
    homepage: "https://github.com/nodeca/js-yaml",
    docs: "https://github.com/nodeca/js-yaml#readme",
    package: "js-yaml",
    usage:
      "YAML parsing for error-taxonomy.yml and config files; minimal runtime dependency alongside effect",
    minVersion: "4.1.0",
    noRepo: true,
  },
  {
    id: "oxc",
    name: "Oxc (oxfmt / oxlint)",
    kind: "library",
    homepage: "https://oxc.rs",
    docs: "https://oxc.rs/docs/guide/usage/formatter.html",
    package: "oxfmt",
    usage: "Format (oxfmt) and lint (oxlint) gates — no ESLint/Prettier in this repo",
    repoId: "oxc-upstream",
  },
] as const;

export const LOCAL_DOC_REFERENCES: readonly LocalDocReference[] = [
  {
    id: "agents",
    repoPath: "AGENTS.md",
    runtimePath: "~/.kimi-code/AGENTS.md",
    purpose: "Toolchain agent guide",
  },
  {
    id: "code-references",
    repoPath: "CODE_REFERENCES.md",
    runtimePath: "~/.kimi-code/CODE_REFERENCES.md",
    purpose: "Local coding exemplars; doc-links lint and @see ladder",
    cursorCanvas: "docs/canvases/doc-links-and-see-ladder.canvas.tsx",
    canvasId: "doc-links-and-see-ladder",
    canvasPage: "Doc links",
    canvasVersion: "0.1.0",
    canvasLayer: "Doc URL lint",
    canvasOpenWhen: "@see ladder · docs/references index",
    canvasReadOrder: 4,
    canvasInfluences: ["card-inspect-table", "card-file-split", "card-transpiler-scan"],
  },
  {
    id: "unified",
    repoPath: "UNIFIED.md",
    runtimePath: "~/.kimi-code/UNIFIED.md",
    purpose: "Kimi Code vs kimi-toolchain matrix",
    cursorCanvas: "docs/canvases/kimi-toolchain.canvas.tsx",
    canvasId: "kimi-toolchain",
    canvasPage: "Hub",
    canvasVersion: "0.1.0",
    canvasLayer: "Project hub",
    canvasOpenWhen: "Architecture, tools, gates — start here",
    canvasReadOrder: 1,
    canvasInfluences: [
      "card-symbols",
      "card-gates",
      "card-bundle",
      "card-compile",
      "card-build",
      "card-scaffold",
    ],
  },
  {
    id: "deep-quality",
    repoPath: "DEEP-QUALITY.md",
    runtimePath: "~/.kimi-code/DEEP-QUALITY.md",
    purpose:
      "Effect-discipline floor and gate JSON shapes; kimi-heal --fix bare-promise repair and KIMI_MODULES=doctor scaffold",
    cursorCanvas: "docs/canvases/kimi-heal-doctor-scaffold.canvas.tsx",
    canvasId: "kimi-heal-doctor-scaffold",
    canvasPage: "Effect heal + doctor",
    canvasVersion: "0.1.0",
    canvasLayer: "kimi-heal --fix · doctor scaffold",
    canvasOpenWhen: "Effect repair · KIMI_MODULES=doctor · perf gates",
    canvasReadOrder: 9,
    canvasInfluences: [
      "card-gates",
      "card-effect-image",
      "card-transpiler-scan",
      "card-kimi-doctor",
      "card-perf-harness",
    ],
  },
  {
    id: "templates",
    repoPath: "TEMPLATES.md",
    runtimePath: "~/.kimi-code/TEMPLATES.md",
    purpose: "Scaffold templates — profiles, snippets, bun create flow, kimi-fix usage",
    cursorCanvas: "docs/canvases/kimi-fix.canvas.tsx",
    canvasId: "kimi-fix",
    canvasPage: "Scaffold",
    canvasVersion: "0.1.0",
    canvasLayer: "kimi-fix · bun create",
    canvasOpenWhen: "Profiles · templates · scaffold doctor",
    canvasReadOrder: 5,
    canvasInfluences: ["card-scaffold", "card-kimi-doctor", "card-gates", "card-kimi-publish"],
  },
  {
    id: "dashboard-thumbnails",
    repoPath: "docs/references/dashboard-thumbnails.md",
    runtimePath: "~/.kimi-code/docs/references/dashboard-thumbnails.md",
    purpose:
      "Herdr dashboard thumbnail pipeline; meta.webview; WebView dataStore vs in-memory cache",
    cursorCanvas: "docs/canvases/herdr-dashboard-thumbnails.canvas.tsx",
    canvasId: "herdr-dashboard-thumbnails",
    canvasPage: "Orchestrator HTTP",
    canvasVersion: "0.1.0",
    canvasLayer: "Orchestrator HTTP",
    canvasOpenWhen: "PNG → Bun.Image → /api/thumbnail",
    canvasReadOrder: 6,
    canvasInfluences: ["card-image", "card-perf-harness"],
  },
  {
    id: "kimi-doctor",
    repoPath: "docs/references/kimi-doctor.md",
    runtimePath: "~/.kimi-code/docs/references/kimi-doctor.md",
    purpose:
      "Dashboard automation gate (kimi-doctor --automation): CLI, JSON schema, exit codes, and failure modes",
    cursorCanvas: "docs/canvases/herdr-dashboard-automation.canvas.tsx",
    canvasId: "herdr-dashboard-automation",
    canvasPage: "Finish-work shell",
    canvasVersion: "1.0.0",
    canvasLayer: "Finish-work shell",
    canvasOpenWhen: "kimi-doctor --automation · gate JSON",
    canvasReadOrder: 7,
    canvasInfluences: ["card-kimi-doctor", "card-gates", "card-perf-harness", "card-perf-registry"],
  },
  {
    id: "serve-probe",
    repoPath: "docs/references/serve-probe.md",
    runtimePath: "~/.kimi-code/docs/references/serve-probe.md",
    purpose:
      "kimi-doctor --serve-probe HTTP routes, [doctor.probe] dx.config.toml, artifact list API, and Herdr tab wiring",
  },
  {
    id: "herdr-socket-saturation-protocol",
    repoPath: "docs/references/herdr-socket-saturation-protocol.md",
    runtimePath: "~/.kimi-code/docs/references/herdr-socket-saturation-protocol.md",
    purpose:
      "Herdr EAGAIN (os error 35) taxonomy, fix-socket --dry-run/--live contract, respawn protection, and Mac mini runbook",
  },
  {
    id: "namespace",
    repoPath: "docs/references/namespace.md",
    runtimePath: "~/.kimi-code/docs/references/namespace.md",
    purpose:
      "Toolchain vs Herdr plugin namespace; doctor trinity (kimi-doctor, herdr-doctor bin/plugin, kimi doctor); global ecosystem; finish-work vs prefix keybindings",
    cursorCanvas: "docs/canvases/namespace-boundaries.canvas.tsx",
    canvasId: "namespace-boundaries",
    canvasPage: "Meta / routing",
    canvasVersion: "0.1.0",
    canvasLayer: "Meta / routing",
    canvasOpenWhen: "Doctor trinity · finish-work vs prefix+*",
    canvasReadOrder: 2,
    canvasInfluences: ["card-gates", "card-symbols", "card-kimi-doctor"],
  },
  {
    id: "configuration-layers",
    repoPath: "docs/references/configuration-layers.md",
    runtimePath: "~/.kimi-code/docs/references/configuration-layers.md",
    purpose:
      "Four-layer model: discovery (canonical-references), define registry (constants-manifest), cross-repo parity (constants-parity.toml), app scaffold (templates/scaffold/bunfig.toml)",
    cursorCanvas: "docs/canvases/configuration-layers.canvas.tsx",
    canvasId: "configuration-layers",
    canvasPage: "Config SSOT",
    canvasVersion: "1.0.0",
    canvasLayer: "Config SSOT",
    canvasOpenWhen: "Discovery · define · parity · scaffold layers",
    canvasReadOrder: 3,
    canvasInfluences: ["card-threshold-overrides", "card-metrics-schema", "card-global-store"],
  },
  {
    id: "shell-spawn-choice",
    repoPath: "docs/references/shell-spawn-choice.md",
    runtimePath: "~/.kimi-code/docs/references/shell-spawn-choice.md",
    purpose: "invokeTool vs Bun.spawn vs governedSpawn decision matrix",
  },
  {
    id: "bun-runtime-scaffold",
    repoPath: "docs/references/bun-runtime-scaffold.md",
    runtimePath: "~/.kimi-code/docs/references/bun-runtime-scaffold.md",
    purpose:
      "Bun install config (bunfig.toml merge order, defaults, env vars, backend, cache/lazy install)",
  },
  {
    id: "testing-execution",
    repoPath: "docs/references/testing-execution.md",
    runtimePath: "~/.kimi-code/docs/references/testing-execution.md",
    purpose:
      "Four-script test execution model — selection (fast/changed/parallel/shard), distribution (file not describe), --changed safety net",
  },
  {
    id: "bun-shell-companions",
    repoPath: "docs/references/bun-shell-companions.md",
    runtimePath: "~/.kimi-code/docs/references/bun-shell-companions.md",
    purpose: "Bun $ template vs subprocess and inspect companion patterns",
  },
  {
    id: "bun-file-streaming",
    repoPath: "docs/references/bun-file-streaming.md",
    runtimePath: "~/.kimi-code/docs/references/bun-file-streaming.md",
    purpose:
      "Bun.file/Bun.write streaming decisions for configs, JSONL ledgers, large artifacts, transformed streams, and HTTP responses",
  },
  {
    id: "template-matrix",
    repoPath: "docs/references/template-matrix.md",
    runtimePath: "~/.kimi-code/docs/references/template-matrix.md",
    purpose:
      "Template families matrix: scaffold breakdown (22 files), bridge pattern collision resolution, runtime sync paths, profile differentiation",
  },
  {
    id: "herdr-plugin-architecture",
    repoPath: "docs/references/herdr-plugin-architecture.md",
    runtimePath: "~/.kimi-code/docs/references/herdr-plugin-architecture.md",
    purpose:
      "Herdr unified plugin plan v0.5.0 — prefix+* actions, STATE_DIR topology; orthogonal to [finishWork].gates",
    cursorCanvas: "docs/canvases/herdr-unified-plugin-architecture.canvas.tsx",
    canvasId: "herdr-unified-plugin-architecture",
    canvasPage: "Herdr plugins",
    canvasVersion: "0.5.0",
    canvasLayer: "Herdr plugins v0.5.0",
    canvasOpenWhen: "prefix+* · orthogonal to finish-work gates",
    canvasReadOrder: 8,
    canvasInfluences: ["card-ipc-matrix", "card-vm-context", "card-ipc"],
  },
  {
    id: "v53-architecture",
    repoPath: "docs/references/v53-architecture.md",
    runtimePath: "~/.kimi-code/docs/references/v53-architecture.md",
    purpose:
      "v5.3 architecture consolidated reference: 9-file map, awk splitter, profile registry, DEFAULT_MODULES, MODULE_REGISTRY, 42-card dashboard, Herdr integration",
    cursorCanvas: "docs/canvases/dashboard-card-registry.canvas.tsx",
    canvasId: "dashboard-card-registry",
    canvasPage: "Card registry",
    canvasVersion: "1.0.0",
    canvasLayer: "v5.4 wiring",
    canvasOpenWhen: "canvasInfluences · /api/cards · lint gate",
    canvasReadOrder: 10,
    canvasInfluences: [
      "card-gates",
      "card-kimi-doctor",
      "card-scaffold",
      "card-perf-harness",
      "card-symbols",
      "card-perf-registry",
    ],
  },
  {
    id: "artifact-lineage",
    repoPath: "examples/artifact-dependency-graphs.md",
    runtimePath: "~/.kimi-code/examples/artifact-dependency-graphs.md",
    purpose:
      "Run manifests, artifact lineage (dependsOn vs gate-graph), and session-scoped identity queries",
    cursorCanvas: "docs/canvases/artifact-lineage.canvas.tsx",
    canvasId: "artifact-lineage",
    canvasPage: "Artifacts & Runs",
    canvasVersion: "1.0.0",
    canvasLayer: "Artifact nervous system",
    canvasOpenWhen: "Run manifests · /api/artifacts · /api/runs · lineage URLPatterns",
    canvasReadOrder: 11,
    canvasInfluences: [
      "card-artifacts",
      "card-gates",
      "card-metrics-schema",
      "card-kimi-doctor",
      "card-trace-verify",
      "card-bunfig-policy",
      "card-url",
    ],
  },
  {
    id: "gate-health",
    repoPath: "docs/references/serve-probe.md",
    runtimePath: "~/.kimi-code/docs/references/serve-probe.md",
    purpose:
      "Live Herdr dashboard gate-health overlay — effect-gates probe, browser poll, server watch",
    cursorCanvas: "docs/canvases/gate-health.canvas.tsx",
    canvasId: "gate-health",
    canvasPage: "Gate Health",
    canvasVersion: "1.0.0",
    canvasLayer: "Effect gates probe",
    canvasOpenWhen: "GET /api/doctor/gates · #gate-health overlay · 30s poll",
    canvasReadOrder: 12,
    canvasInfluences: ["card-gates", "card-kimi-doctor"],
  },
  {
    id: "benchmark",
    repoPath: "docs/references/kimi-doctor.md",
    runtimePath: "~/.kimi-code/docs/references/kimi-doctor.md",
    purpose:
      "BenchmarkApiEnvelope SSOT — runEffectBenchmarkCardLoop shared by CLI, dashboard, and serve-probe",
    cursorCanvas: "docs/canvases/benchmark.canvas.tsx",
    canvasId: "benchmark",
    canvasPage: "Effect Benchmark",
    canvasVersion: "1.0.0",
    canvasLayer: "Perf gates probe",
    canvasOpenWhen: "GET /api/effect-benchmark · serve-probe · 30s poll",
    canvasReadOrder: 13,
    canvasInfluences: ["card-effect-benchmark", "card-perf-harness", "card-kimi-doctor"],
  },
  {
    id: "agent-api",
    repoPath: "docs/agent-api.md",
    runtimePath: "~/.kimi-code/docs/agent-api.md",
    purpose:
      "Effect-native agent API surface: KimiCapabilities, KimiTrace, KimiContract, DecisionLogger services — use instead of CLI shelling out inside Effect programs",
  },
  {
    id: "finish-work-close-loop",
    repoPath: "docs/finish-work-close-loop.md",
    runtimePath: "~/.kimi-code/docs/finish-work-close-loop.md",
    purpose:
      "Finish-work close-loop architecture: gates → git → dirty check → reviewer escalation → orchestrator signal; dx.config.toml [finishWork] and [herdr.orchestrator] wiring",
  },
  {
    id: "handoff-rules",
    repoPath: "docs/handoff-rules.md",
    runtimePath: "~/.kimi-code/docs/handoff-rules.md",
    purpose:
      "Herdr orchestrator handoff rules: TOML format, condition syntax (done/blocked/idle/probe:*), report-native when-clauses, and cross-workspace agent routing",
  },
  {
    id: "naming",
    repoPath: "docs/naming.md",
    runtimePath: "~/.kimi-code/docs/naming.md",
    purpose:
      "CLI naming notes and deprecation register: --session-report → --effect-floor; kimi-doctor vs herdr-doctor vs kimi doctor disambiguation shortcuts",
  },
  {
    id: "canonical-references",
    repoPath: CANONICAL_REFERENCES_FILENAME,
    runtimePath: `~/.kimi-code/${CANONICAL_REFERENCES_FILENAME}`,
    purpose: "Cached canonical ecosystem links (this manifest)",
  },
] as const;

export const REPO_REFERENCES: readonly RepoReference[] = [
  {
    id: "kimi-toolchain",
    name: "kimi-toolchain",
    url: "https://github.com/brendadeeznuts1111/kimi-toolchain",
    description: "Bun-native developer tooling: governance, diagnostics, security, and scaffolding",
    defaultBranch: "main",
    ciStatusUrl: "https://github.com/brendadeeznuts1111/kimi-toolchain/actions",
    clonePath: "~/kimi-toolchain",
    role: "tool",
    language: "typescript",
    frameworks: ["bun", "effect", "oxc"],
    expectedPackageName: "kimi-toolchain",
  },
  {
    id: "kimi-code-upstream",
    name: "Kimi Code (Moonshot)",
    url: "https://github.com/MoonshotAI/kimi-code",
    description: "Official Kimi Code agent CLI, config.toml, sessions, and MCP integration",
    defaultBranch: "main",
    ciStatusUrl: "https://github.com/MoonshotAI/kimi-code/actions",
    provides: ["kimi-code"],
    role: "upstream",
    language: "typescript",
    frameworks: ["node"],
  },
  {
    id: "effect-upstream",
    name: "Effect",
    url: "https://github.com/Effect-TS/effect",
    description: "Typed functional effect system for TypeScript services and CLI pipelines",
    defaultBranch: "main",
    ciStatusUrl: "https://github.com/Effect-TS/effect/actions",
    provides: ["effect"],
    role: "upstream",
    language: "typescript",
    frameworks: ["effect", "node"],
  },
  {
    id: "oxc-upstream",
    name: "Oxc",
    url: "https://github.com/oxc-project/oxc",
    description: "Rust-based JavaScript toolchain (oxfmt, oxlint) used in format and lint gates",
    defaultBranch: "main",
    ciStatusUrl: "https://github.com/oxc-project/oxc/actions",
    provides: ["oxc"],
    role: "upstream",
    language: "rust",
    frameworks: ["oxc"],
  },
] as const;

/** Repo-root manifest path (not the synced runtime copy — use paths.canonicalReferencesPath). */
export function repoCanonicalReferencesPath(projectRoot: string): string {
  return join(projectRoot, CANONICAL_REFERENCES_FILENAME);
}

export function buildCanonicalReferencesManifest(): CanonicalReferencesManifest {
  return {
    schemaVersion: CANONICAL_REFERENCES_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    toolchainVersion: TOOLCHAIN_VERSION,
    ecosystem: [...ECOSYSTEM_REFERENCES],
    localDocs: [...LOCAL_DOC_REFERENCES],
    repos: [...REPO_REFERENCES],
  };
}

export function isCanonicalReferencesManifest(val: unknown): val is CanonicalReferencesManifest {
  if (typeof val !== "object" || val === null) return false;
  const v = val as CanonicalReferencesManifest;
  return (
    v.schemaVersion === CANONICAL_REFERENCES_SCHEMA_VERSION &&
    typeof v.generatedAt === "string" &&
    typeof v.toolchainVersion === "string" &&
    Array.isArray(v.ecosystem) &&
    Array.isArray(v.localDocs) &&
    Array.isArray(v.repos)
  );
}

export async function readCanonicalReferencesFile(
  filePath: string
): Promise<CanonicalReferencesManifest | null> {
  if (!pathExists(filePath)) return null;
  try {
    const parsed: unknown = await Bun.file(filePath).json();
    return isCanonicalReferencesManifest(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function readCanonicalReferencesManifest(
  projectRoot: string
): Promise<CanonicalReferencesManifest | null> {
  return readCanonicalReferencesFile(repoCanonicalReferencesPath(projectRoot));
}

export interface CanonicalReferencesHealthCheck {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
  fixable: boolean;
}

export interface CanonicalReferencesHealthReport {
  applicable: boolean;
  aligned: boolean;
  checks: CanonicalReferencesHealthCheck[];
  fixPlan: string[];
  repoManifest: CanonicalReferencesManifest | null;
  runtimeManifest: CanonicalReferencesManifest | null;
  runtimeSynced: boolean;
}

/** Probe IDs for herdr orchestrator handoff rules (`probe:<id>`). */
export const CANONICAL_REFERENCES_PROBE_IDS = [
  "canonical-references:repo-fresh",
  "canonical-references:runtime-aligned",
  "canonical-references:runtime-cache",
] as const;

export type CanonicalReferencesProbeId = (typeof CANONICAL_REFERENCES_PROBE_IDS)[number];

export function isCanonicalReferencesProbeId(id: string): id is CanonicalReferencesProbeId {
  return (CANONICAL_REFERENCES_PROBE_IDS as readonly string[]).includes(id);
}

type CanonicalReferencesProbeSuffix = "repo-fresh" | "runtime-aligned" | "runtime-cache";

/** Map probe suffixes to health checks, including prerequisite fallbacks. */
export function resolveProbeHealthCheck(
  suffix: CanonicalReferencesProbeSuffix,
  checks: CanonicalReferencesHealthCheck[]
): CanonicalReferencesHealthCheck | null {
  const byName = (name: string) => checks.find((entry) => entry.name === name);

  if (suffix === "runtime-cache") {
    const cache = byName("runtime-cache");
    if (cache) return cache;
    if (byName("runtime-aligned")) {
      return {
        name: "runtime-cache",
        status: "ok",
        message: "runtime cache present at ~/.kimi-code/",
        fixable: false,
      };
    }
    return byName("repo-manifest") ?? byName("repo-fresh") ?? null;
  }

  if (suffix === "repo-fresh") {
    return byName("repo-fresh") ?? byName("repo-manifest") ?? null;
  }

  return (
    byName("runtime-aligned") ??
    byName("runtime-cache") ??
    byName("repo-fresh") ??
    byName("repo-manifest") ??
    null
  );
}

/** Evaluate a `probe:canonical-references:*` handoff condition. */
export async function evaluateProbeHandoffCondition(
  probeId: string,
  projectRoot: string,
  home?: string
): Promise<{ ok: boolean; message: string }> {
  if (!isCanonicalReferencesProbeId(probeId)) {
    return { ok: false, message: `unknown probe condition: ${probeId}` };
  }
  const report = await auditCanonicalReferencesHealth(projectRoot, home);
  if (!report.applicable) {
    return { ok: false, message: "canonical references health not applicable for this project" };
  }
  const suffix = probeId.slice("canonical-references:".length) as CanonicalReferencesProbeSuffix;
  const check = resolveProbeHealthCheck(suffix, report.checks);
  if (!check) {
    return { ok: false, message: `probe check missing: ${probeId}` };
  }
  return {
    ok: check.status === "ok",
    message:
      check.status === "ok"
        ? check.message
        : `${check.message} — ${report.fixPlan[0] ?? "fix required"}`,
  };
}

/** Verify repo manifest freshness and ~/.kimi-code/ cached copy alignment. */
export async function auditCanonicalReferencesHealth(
  projectRoot: string,
  home?: string
): Promise<CanonicalReferencesHealthReport> {
  const checks: CanonicalReferencesHealthCheck[] = [];
  const fixPlan: string[] = [];
  const repoPath = repoCanonicalReferencesPath(projectRoot);
  const runtimePath = canonicalReferencesPath(home);

  if (!pathExists(repoPath)) {
    return {
      applicable: pathExists(join(projectRoot, "src/lib/canonical-references.ts")),
      aligned: false,
      checks: [
        {
          name: "repo-manifest",
          status: "error",
          message: `${CANONICAL_REFERENCES_FILENAME} missing — run bun run references:generate`,
          fixable: true,
        },
      ],
      fixPlan: ["bun run references:generate"],
      repoManifest: null,
      runtimeManifest: null,
      runtimeSynced: false,
    };
  }

  const generated = buildCanonicalReferencesManifest();
  const repoManifest = await readCanonicalReferencesFile(repoPath);
  if (!repoManifest) {
    checks.push({
      name: "repo-manifest",
      status: "error",
      message: `${CANONICAL_REFERENCES_FILENAME} invalid JSON or schema`,
      fixable: true,
    });
    fixPlan.push("bun run references:generate");
  } else if (manifestNeedsRefresh(generated, repoManifest)) {
    checks.push({
      name: "repo-fresh",
      status: "error",
      message: "repo manifest stale vs src/lib/canonical-references.ts",
      fixable: true,
    });
    fixPlan.push("bun run references:generate");
  } else {
    checks.push({
      name: "repo-fresh",
      status: "ok",
      message: "repo manifest matches source tables",
      fixable: false,
    });
  }

  const runtimeManifest = await readCanonicalReferencesFile(runtimePath);
  if (!runtimeManifest) {
    checks.push({
      name: "runtime-cache",
      status: "error",
      message: "runtime cache missing at ~/.kimi-code/",
      fixable: true,
    });
    fixPlan.push("bun run sync");
  } else if (repoManifest && !referencesContentEqual(repoManifest, runtimeManifest)) {
    checks.push({
      name: "runtime-aligned",
      status: "error",
      message: "runtime cache drifted from repo manifest",
      fixable: true,
    });
    fixPlan.push("bun run sync");
  } else if (repoManifest) {
    checks.push({
      name: "runtime-aligned",
      status: "ok",
      message: "runtime cache matches repo manifest",
      fixable: false,
    });
  }

  const pkgPath = join(projectRoot, "package.json");
  if (pathExists(pkgPath)) {
    try {
      const pkg = (await Bun.file(pkgPath).json()) as {
        kimi?: { canonicalReferences?: string };
      };
      const pointer = pkg.kimi?.canonicalReferences;
      if (pointer === CANONICAL_REFERENCES_FILENAME) {
        checks.push({
          name: "package-pointer",
          status: "ok",
          message: `package.json → kimi.canonicalReferences`,
          fixable: false,
        });
      } else {
        checks.push({
          name: "package-pointer",
          status: "warn",
          message: "package.json kimi.canonicalReferences missing or mispointed",
          fixable: true,
        });
      }
    } catch {
      // skip package parse errors
    }
  }

  const aligned = checks.every((check) => check.status === "ok");
  return {
    applicable: true,
    aligned,
    checks,
    fixPlan: [...new Set(fixPlan)],
    repoManifest,
    runtimeManifest,
    runtimeSynced: Boolean(
      repoManifest && runtimeManifest && referencesContentEqual(repoManifest, runtimeManifest)
    ),
  };
}

/** Compare link tables only — ignore generatedAt/toolchainVersion timestamps. */
export function referencesContentEqual(
  a: CanonicalReferencesManifest,
  b: CanonicalReferencesManifest
): boolean {
  return (
    a.schemaVersion === b.schemaVersion &&
    stableStringify(a.ecosystem) === stableStringify(b.ecosystem) &&
    stableStringify(a.localDocs) === stableStringify(b.localDocs) &&
    stableStringify(a.repos) === stableStringify(b.repos)
  );
}

/** Preserve generatedAt when link tables are unchanged — avoids timestamp-only git drift on sync. */
export function finalizeCanonicalReferencesManifest(
  generated: CanonicalReferencesManifest,
  existing: CanonicalReferencesManifest | null
): CanonicalReferencesManifest {
  if (existing && referencesContentEqual(generated, existing)) {
    return { ...generated, generatedAt: existing.generatedAt };
  }
  return generated;
}

export function manifestNeedsRefresh(
  generated: CanonicalReferencesManifest,
  existing: CanonicalReferencesManifest | null
): boolean {
  if (!existing) return true;
  return !referencesContentEqual(generated, existing);
}

export type EcosystemId = (typeof ECOSYSTEM_REFERENCES)[number]["id"];
export type RepoId = (typeof REPO_REFERENCES)[number]["id"];

function buildRepoById(): Record<RepoId, RepoReference> {
  const map = {} as Record<RepoId, RepoReference>;
  for (const repo of REPO_REFERENCES) {
    map[repo.id as RepoId] = repo;
  }
  return map;
}

/** O(1) typed lookup — prefer over scanning REPO_REFERENCES. */
export const REPO_BY_ID: Record<RepoId, RepoReference> = buildRepoById();

/** Normalize GitHub URLs for reverse lookup (strip .git, trailing slash, lowercase host/path). */
export function normalizeRepoUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/$/, "").replace(/\.git$/, "");
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${path.toLowerCase()}`;
  } catch {
    return url
      .trim()
      .toLowerCase()
      .replace(/\.git$/, "")
      .replace(/\/$/, "");
  }
}

function buildRepoByUrl(): ReadonlyMap<string, RepoReference> {
  const map = new Map<string, RepoReference>();
  for (const repo of REPO_REFERENCES) {
    map.set(normalizeRepoUrl(repo.url), repo);
  }
  return map;
}

const REPO_BY_URL = buildRepoByUrl();

export function expandClonePath(clonePath: string): string {
  if (clonePath.startsWith("~/")) return join(homeDir(), clonePath.slice(2));
  if (clonePath === "~") return homeDir();
  return clonePath;
}

export function getEcosystem(id: EcosystemId): EcosystemReference {
  return ECOSYSTEM_REFERENCES.find((ref) => ref.id === id) as EcosystemReference;
}

export function getRepo(id: RepoId): RepoReference {
  return REPO_BY_ID[id];
}

/** Resolve a repository from a GitHub URL (or normalized equivalent). */
export function getRepoByUrl(url: string): RepoReference | undefined {
  return REPO_BY_URL.get(normalizeRepoUrl(url));
}

/** Resolve a repository id from a GitHub URL — convenience over getRepoByUrl(). */
export function getRepoIdByUrl(url: string): RepoId | undefined {
  return getRepoByUrl(url)?.id;
}

/**
 * Resolve the REPO_REFERENCES entry for an ecosystem entry.
 * Uses explicit `repoId` when set; falls back to `<ecosystemId>-upstream` convention.
 */
export function resolveRepoForEcosystem(ref: EcosystemReference): RepoReference | undefined {
  if (ref.noRepo) return undefined;
  const repoId = ref.repoId ?? `${ref.id}-upstream`;
  return REPO_BY_ID[repoId as RepoId];
}

const GITHUB_URL_PATTERN = new URLPattern({
  protocol: "https",
  hostname: "github.com",
  pathname: "/:org/:repo{.git}?",
});

/** Validate that every REPO_REFERENCES url follows the canonical https://github.com/:org/:repo shape. */
export function lintRepoUrls(): string[] {
  const violations: string[] = [];
  for (const repo of REPO_REFERENCES) {
    if (!GITHUB_URL_PATTERN.test(repo.url)) {
      violations.push(
        `repo "${repo.id}": url "${repo.url}" does not match expected pattern https://github.com/:org/:repo`
      );
    } else if (repo.url.endsWith(".git")) {
      violations.push(
        `repo "${repo.id}": url "${repo.url}" has trailing .git — use bare HTTPS URL`
      );
    } else if (repo.url.endsWith("/")) {
      violations.push(`repo "${repo.id}": url "${repo.url}" has trailing slash — remove it`);
    }
  }
  return violations;
}

/** Lint duplicate repo ids and normalized URLs. */
export function lintRepoDuplicateKeys(): string[] {
  const violations: string[] = [];
  const seenIds = new Map<string, number>();
  const seenUrls = new Map<string, string>();

  for (const repo of REPO_REFERENCES) {
    seenIds.set(repo.id, (seenIds.get(repo.id) ?? 0) + 1);
    const normalized = normalizeRepoUrl(repo.url);
    const prior = seenUrls.get(normalized);
    if (prior) {
      violations.push(`repo duplicate url: "${repo.id}" and "${prior}" both map to ${normalized}`);
    } else {
      seenUrls.set(normalized, repo.id);
    }
  }

  for (const [id, count] of seenIds) {
    if (count > 1) violations.push(`repo duplicate id: "${id}" appears ${count} times`);
  }

  return violations;
}

/** Lint repo.provides ↔ ecosystem.repoId bidirectional links. */
export function lintRepoProvidesLinks(): string[] {
  const violations: string[] = [];

  for (const repo of REPO_REFERENCES) {
    for (const ecoId of repo.provides ?? []) {
      const eco = ecosystemReferenceById(ecoId);
      if (!eco) {
        violations.push(`repo "${repo.id}": provides unknown ecosystem id "${ecoId}"`);
        continue;
      }
      const linked = resolveRepoForEcosystem(eco);
      if (!linked || linked.id !== repo.id) {
        violations.push(
          `repo "${repo.id}": provides "${ecoId}" but ecosystem links to "${linked?.id ?? "none"}"`
        );
      }
    }
  }

  return violations;
}

export interface LintRepoClonePathsOptions {
  /** Accept this directory as a valid clone root for kimi-toolchain (worktree-safe). */
  projectRoot?: string;
  /** Skip filesystem checks (unit tests / sandboxes without canonical clone). */
  skipFilesystem?: boolean;
}

/** Validate clonePath exists and package.json name matches expectedPackageName. */
export function lintRepoClonePaths(options: LintRepoClonePathsOptions = {}): string[] {
  if (options.skipFilesystem) return [];

  const violations: string[] = [];
  const projectRoot = options.projectRoot ?? process.cwd();

  for (const repo of REPO_REFERENCES) {
    if (!repo.clonePath) continue;

    const absolute = expandClonePath(repo.clonePath);
    const expectedName = repo.expectedPackageName ?? repo.name;
    const candidateRoots = new Set([absolute]);
    if (repo.id === "kimi-toolchain") candidateRoots.add(projectRoot);

    let matched = false;
    for (const root of candidateRoots) {
      const pkgPath = join(root, "package.json");
      if (!pathExists(pkgPath)) continue;
      const pkg = safeParse(readText(pkgPath), {} as { name?: string });
      if (pkg.name === expectedName) {
        matched = true;
        break;
      }
    }

    if (matched) continue;

    if (!pathExists(absolute)) {
      violations.push(`repo "${repo.id}": clonePath "${repo.clonePath}" does not exist`);
      continue;
    }

    violations.push(
      `repo "${repo.id}": clonePath "${repo.clonePath}" missing package.json name "${expectedName}"`
    );
  }

  return violations;
}

/** Combined repo reference lint — URLs, duplicates, provides links, ecosystem pairing, clone paths. */
export function lintRepoReferences(options: LintRepoClonePathsOptions = {}): string[] {
  return [
    ...lintRepoUrls(),
    ...lintRepoDuplicateKeys(),
    ...lintRepoProvidesLinks(),
    ...lintEcosystemRepoCompleteness(),
    ...lintRepoClonePaths(options),
  ];
}

/**
 * Lint: verify ecosystem ↔ repo pairing completeness.
 * Returns violation strings; empty array = OK.
 */
export function lintEcosystemRepoCompleteness(): string[] {
  const violations: string[] = [];
  const linkedKinds: ReferenceKind[] = ["library", "runtime", "product"];

  for (const ref of ECOSYSTEM_REFERENCES) {
    if (ref.noRepo) continue;
    if (!linkedKinds.includes(ref.kind)) continue;
    const repo = resolveRepoForEcosystem(ref);
    if (!repo) {
      const convention = `${ref.id}-upstream`;
      violations.push(
        `ecosystem "${ref.id}" (${ref.kind}): no repo entry found — add repoId or create REPO_REFERENCES entry "${convention}", or set noRepo: true`
      );
    }
  }

  for (const repo of REPO_REFERENCES) {
    const provides = repo.provides ?? [];
    if (provides.length > 0) continue;
    if (repo.role === "tool") continue;
    if (!repo.clonePath) continue;

    const hasCounterpart = ECOSYSTEM_REFERENCES.some(
      (e) => (e.repoId ?? `${e.id}-upstream`) === repo.id
    );
    if (!hasCounterpart) {
      violations.push(
        `repo "${repo.id}" has clonePath but no ecosystem entry references it — add provides, repoId on ecosystem, or remove clonePath`
      );
    }
  }

  return violations;
}

export function ecosystemReferenceById(id: string): EcosystemReference | undefined {
  return ECOSYSTEM_REFERENCES.find((ref) => ref.id === id);
}

export function localDocReferenceById(id: string): LocalDocReference | undefined {
  return LOCAL_DOC_REFERENCES.find((r) => r.id === id);
}

function docsLink(ref: EcosystemReference): string {
  if (ref.docs.startsWith("http://") || ref.docs.startsWith("https://")) {
    return `[docs](${ref.docs})`;
  }
  return `\`${ref.docs}\``;
}

/** Parse a GitHub repo URL into a short owner/repo display slug and link target. */
export function repoUrlParts(url: string): { display: string; href: string } {
  try {
    const pattern = new URLPattern("https://github.com/:owner/:repo");
    const match = pattern.exec(url);
    if (match?.pathname.groups) {
      const owner = match.pathname.groups.owner ?? "";
      const repo = (match.pathname.groups.repo ?? "").replace(/\.git$/, "");
      if (owner && repo) {
        return { display: `${owner}/${repo}`, href: url };
      }
    }
  } catch {
    // URLPattern unavailable or malformed URL — fall through
  }

  try {
    const parsed = new URL(url);
    const segments = parsed.pathname
      .replace(/\/$/, "")
      .replace(/\.git$/, "")
      .split("/")
      .filter(Boolean);
    if (parsed.host.toLowerCase() === "github.com" && segments.length >= 2) {
      return { display: `${segments[0]}/${segments[1]}`, href: url };
    }
  } catch {
    // ignore
  }

  return { display: url, href: url };
}

function formatRepoRoleProvides(ref: RepoReference): string {
  const parts: string[] = [];
  if (ref.role) parts.push(ref.role);
  if (ref.provides?.length) parts.push(ref.provides.join(", "));
  return parts.join(" / ") || "—";
}

/** Column descriptor for a generic markdown table builder. */
interface ColumnDef<T> {
  header: string;
  cell: (item: T) => string;
  align?: "left" | "center" | "right";
}

/** Escape pipe characters inside a table cell so they don't break column parsing. */
function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|");
}

/** Render an array of items as a GFM markdown table using column descriptors. */
function buildTable<T>(items: readonly T[], columns: ColumnDef<T>[]): string {
  const headerRow = "| " + columns.map((c) => c.header).join(" | ") + " |";
  const separator =
    "| " +
    columns
      .map((c) => {
        if (c.align === "center") return ":---:";
        if (c.align === "right") return "---:";
        return ":---";
      })
      .join(" | ") +
    " |";
  const dataRows = items.map(
    (item) => "| " + columns.map((c) => escapeCell(c.cell(item))).join(" | ") + " |"
  );
  return [headerRow, separator, ...dataRows].join("\n");
}

const ECOSYSTEM_COLUMNS: ColumnDef<EcosystemReference>[] = [
  { header: "Stack", cell: (e) => e.name },
  { header: "Docs", cell: (e) => docsLink(e) },
  { header: "Usage in this repo", cell: (e) => e.usage },
];

const LOCAL_DOC_COLUMNS: ColumnDef<LocalDocReference>[] = [
  { header: "Repo", cell: (d) => `\`${d.repoPath}\`` },
  { header: "Runtime", cell: (d) => `\`${d.runtimePath}\`` },
  { header: "Purpose", cell: (d) => d.purpose },
];

const REPO_COLUMNS: ColumnDef<RepoReference>[] = [
  { header: "Key", cell: (r) => `\`${r.id}\`` },
  { header: "Project", cell: (r) => r.name },
  {
    header: "Source",
    cell: (r) => {
      const { display, href } = repoUrlParts(r.url);
      return `[${display}](${href})`;
    },
  },
  {
    header: "Clone path",
    cell: (r) => (r.clonePath ? `\`${r.clonePath}\`` : "—"),
  },
  { header: "Role / provides", cell: formatRepoRoleProvides },
];

/** Markdown block for CONTEXT.md (compact) or full tables. */
export function formatCanonicalReferencesMarkdown(compact = false): string {
  if (compact) {
    const stacks = ECOSYSTEM_REFERENCES.map((ref) => ref.name).join(", ");
    return `## Canonical References

Cached manifest: \`${CANONICAL_REFERENCES_FILENAME}\` (\`bun run references:generate\`; synced to \`~/.kimi-code/\`). Stacks: ${stacks}. Full tables: \`CODE_REFERENCES.md\` § Canonical ecosystem links.

`;
  }

  return `## Canonical References

Machine-readable manifest: \`${CANONICAL_REFERENCES_FILENAME}\` (synced to \`~/.kimi-code/\`). Regenerate: \`bun run references:generate\`.

### Ecosystem

${buildTable(ECOSYSTEM_REFERENCES, ECOSYSTEM_COLUMNS)}

### Local docs (cached after sync)

${buildTable(LOCAL_DOC_REFERENCES, LOCAL_DOC_COLUMNS)}

### Repositories

${buildTable(REPO_REFERENCES, REPO_COLUMNS)}
`;
}
