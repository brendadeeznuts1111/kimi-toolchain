/**
 * examples/ showcase registry — SSOT for /api/examples and the dashboard hub.
 * Maps runnable projects and narrative guides to dashboard card ids and lanes.
 */

import { join } from "path";
import { CANONICAL_DASHBOARD_PORT } from "./dashboard-constants.ts";
import { listDir, pathExists, readText } from "./bun-io.ts";
import { loadDashboardCardIds } from "./dashboard-card-loader.ts";

export const EXAMPLES_SHOWCASE_SCHEMA_VERSION = 1 as const;

export type ShowcaseKind = "project" | "guide";
export type ShowcaseLaneId = "runtime" | "control-plane" | "effect-perf" | "agent-workflows";

export interface ShowcaseLane {
  id: ShowcaseLaneId;
  title: string;
  subtitle: string;
  order: number;
  accent: string;
}

export interface ShowcaseEntry {
  id: string;
  kind: ShowcaseKind;
  lane: ShowcaseLaneId;
  order: number;
  title: string;
  tagline: string;
  /** Repo-relative path (directory for projects, file for guides). */
  path: string;
  accent: string;
  /** Dashboard card ids this example highlights (scroll/filter targets). */
  cardIds: readonly string[];
  /** Related markdown or doc paths. */
  relatedDocs: readonly string[];
  /** Primary commands to try. */
  commands: readonly string[];
  /** Control-plane layer when applicable (L1–L3). */
  controlPlaneLevel?: 1 | 2 | 3;
  /** Short persona hook for narrative guides. */
  persona?: string;
}

export const SHOWCASE_LANES: readonly ShowcaseLane[] = [
  {
    id: "runtime",
    title: "Live Runtime",
    subtitle: "Runnable demos — start a server or CLI and watch artifacts flow",
    order: 1,
    accent: "#58a6ff",
  },
  {
    id: "control-plane",
    title: "Control Plane",
    subtitle: "Gates, artifacts, lineage graphs, and layered retention",
    order: 2,
    accent: "#3fb950",
  },
  {
    id: "effect-perf",
    title: "Effect & Perf",
    subtitle: "Symbol contracts, benchmarks, and platform absorption",
    order: 3,
    accent: "#d29922",
  },
  {
    id: "agent-workflows",
    title: "Agent Workflows",
    subtitle: "How agents diagnose, recover, and ship safely",
    order: 4,
    accent: "#f778ba",
  },
] as const;

export const SHOWCASE_ENTRIES: readonly ShowcaseEntry[] = [
  {
    id: "dashboard",
    kind: "project",
    lane: "runtime",
    order: 1,
    title: "Bun API Dashboard",
    tagline: "77 live cards — every Bun-native surface in one page with canvas filters and probes",
    path: "examples/dashboard",
    accent: "#58a6ff",
    cardIds: [
      "card-gates",
      "card-kimi-doctor",
      "card-scaffold",
      "card-perf-harness",
      "card-perf-registry",
      "card-effect-benchmark",
      "card-symbols",
      "card-artifacts",
      "card-url",
      "card-http2",
    ],
    relatedDocs: [
      "examples/dashboard/README.md",
      "examples/dashboard/v53/README.md",
      "examples/dashboard-urls.md",
      "docs/references/v53-architecture.md",
      "docs/references/serve-probe.md",
    ],
    commands: [
      "cd examples/dashboard && bun run src/index.ts",
      "open http://127.0.0.1:5678?example=dashboard&canvas=kimi-doctor",
      "cd examples/dashboard && bun run perf",
    ],
    controlPlaneLevel: 1,
  },
  {
    id: "portal",
    kind: "project",
    lane: "runtime",
    order: 2,
    title: "Artifact Portal",
    tagline:
      "One command — Canvas, serve-probe, and Herdr converge into benchmark diagnostics on disk",
    path: "examples/portal",
    accent: "#a371f7",
    cardIds: ["card-effect-benchmark", "card-perf-harness", "card-kimi-doctor", "card-bun-test"],
    relatedDocs: [
      "examples/portal/README.md",
      "examples/artifact-portal.md",
      "contracts/artifact-portal.json",
      "docs/references/serve-probe.md",
      "docs/references/testing-execution.md",
    ],
    commands: [
      "cd examples/portal && bun run portal:local",
      "bun run build:portal",
      "bun run test:portal-convergence:fast",
      "bun run build:portal:local",
      "open http://127.0.0.1:5678/?example=portal&canvas=benchmark#card-bun-test",
      "curl -s http://127.0.0.1:5678/api/effect-benchmark | jq '.metadata.testExecution.changedImportGraph.title'",
    ],
    controlPlaneLevel: 1,
  },
  {
    id: "dashboard-urls",
    kind: "guide",
    lane: "runtime",
    order: 4,
    title: "Dashboard URLs & Ports",
    tagline: "URLPattern routes, port properties, protocol layers, and dx:table URL decomposition",
    path: "examples/dashboard-urls.md",
    accent: "#79c0ff",
    cardIds: ["card-url", "card-url-node", "card-http2", "card-artifacts"],
    relatedDocs: [
      "schemas/endpoints.schema.toml",
      "docs/references/serve-probe.md",
      "src/lib/dashboard-route-patterns.ts",
    ],
    commands: [
      "bun test test/dashboard-route-patterns.unit.test.ts",
      "bun run dx:table extract dx.config.toml endpoints -u --exact",
    ],
    controlPlaneLevel: 1,
  },
  {
    id: "trading-workspace",
    kind: "project",
    lane: "runtime",
    order: 3,
    title: "Trading Artifact Loop",
    tagline: "Alex the quant — L1 freshness/risk gates feed L2 strategy drift with saved lineage",
    path: "examples/trading-workspace",
    accent: "#3fb950",
    cardIds: ["card-artifacts", "card-gates", "card-metrics-schema"],
    relatedDocs: [
      "examples/trading-workspace/README.md",
      "examples/artifact-trading-loop.md",
      "examples/control-plane-layers.md",
    ],
    commands: [
      "cd examples/trading-workspace && bun run trading",
      "cd examples/trading-workspace && bun run trading:graph",
      "kimi-doctor --artifacts-list strategy-performance",
    ],
    controlPlaneLevel: 2,
    persona: "Alex — independent quant trader",
  },
  {
    id: "gates",
    kind: "project",
    lane: "runtime",
    order: 5,
    title: "Generic Gate Tree",
    tagline: "Minimal L1→L2 gate tree — the sourceExample for the kimi-gates bun-create template",
    path: "examples/gates",
    accent: "#3fb950",
    cardIds: ["card-artifacts", "card-gates", "card-metrics-schema"],
    relatedDocs: [
      "examples/gates/README.md",
      "examples/control-plane-layers.md",
      "examples/artifact-dependency-graphs.md",
    ],
    commands: [
      "cd examples/gates && bun run gate:all",
      "cd examples/gates && bun run gate:graph",
      "kimi-doctor --artifacts-list health-check",
    ],
    controlPlaneLevel: 1,
  },
  {
    id: "artifact-portal",
    kind: "guide",
    lane: "control-plane",
    order: 1,
    title: "Artifact Portal Convergence",
    tagline: "benchmark.canvas → serve-probe → build:portal → .kimi/artifacts/artifact-portal/",
    path: "examples/artifact-portal.md",
    accent: "#bc8cff",
    cardIds: [
      "card-effect-benchmark",
      "card-perf-harness",
      "card-kimi-doctor",
      "card-bun-test",
      "card-artifacts",
    ],
    relatedDocs: [
      "examples/portal/README.md",
      "contracts/artifact-portal.json",
      "src/canvases/benchmark.manifest.ts",
      "docs/references/testing-execution.md",
    ],
    commands: [
      "cd examples/portal && bun run portal:local",
      "kimi-doctor --artifacts-list artifact-portal",
      "curl -s http://127.0.0.1:5678/api/effect-benchmark | jq '.metadata.testExecution.changedImportGraph.title'",
    ],
    controlPlaneLevel: 1,
  },
  {
    id: "control-plane-layers",
    kind: "guide",
    lane: "control-plane",
    order: 2,
    title: "Control Plane Layers",
    tagline: "L0 events stay out of the store — artifacts begin at L1 tactical summaries",
    path: "examples/control-plane-layers.md",
    accent: "#3fb950",
    cardIds: ["card-artifacts", "card-gates", "card-threshold-overrides"],
    relatedDocs: [
      "docs/adr/ADR-0004-serve-probe-readonly.md",
      "examples/artifact-dependency-graphs.md",
    ],
    commands: [
      "kimi-doctor --gate bunfig-policy --save-artifact",
      "kimi-doctor --artifacts-list card-probe",
    ],
    controlPlaneLevel: 3,
  },
  {
    id: "artifact-dependency-graphs",
    kind: "guide",
    lane: "control-plane",
    order: 3,
    title: "Artifact Dependency Graphs",
    tagline: "Data lineage (what consumed what) vs gate order (what runs before what)",
    path: "examples/artifact-dependency-graphs.md",
    accent: "#56d364",
    cardIds: ["card-artifacts", "card-trace-verify"],
    relatedDocs: ["examples/dependency-graphs-developer-workflow.md"],
    commands: [
      "kimi-doctor --gate model-drift --gate-graph",
      "kimi-doctor --artifacts-lineage model-drift --json",
    ],
    controlPlaneLevel: 2,
  },
  {
    id: "dependency-graphs-developer-workflow",
    kind: "guide",
    lane: "control-plane",
    order: 4,
    title: "Developer Workflow",
    tagline: "Daily CLI cheat sheet — dry-run, gate-graph, save-artifact, dashboard observe",
    path: "examples/dependency-graphs-developer-workflow.md",
    accent: "#7ee787",
    cardIds: ["card-artifacts", "card-kimi-doctor", "card-gates"],
    relatedDocs: ["docs/references/kimi-doctor.md"],
    commands: [
      "kimi-doctor --gate perf-gate --dryrun --json",
      "kimi-doctor --run-gates --save-artifact",
    ],
    controlPlaneLevel: 2,
  },
  {
    id: "artifact-trading-loop",
    kind: "guide",
    lane: "control-plane",
    order: 5,
    title: "Trading Feedback Loop",
    tagline: "Minute-level L1 gates → daily L2 drift → alert and resize positions",
    path: "examples/artifact-trading-loop.md",
    accent: "#2ea043",
    cardIds: ["card-artifacts", "card-metrics-schema"],
    relatedDocs: ["examples/trading-workspace/README.md"],
    commands: [
      "cd examples/trading-workspace && bun run trading:drift",
      "kimi-doctor --artifacts-latest model-drift",
    ],
    controlPlaneLevel: 2,
    persona: "Alex — independent quant trader",
  },
  {
    id: "image-effect",
    kind: "guide",
    lane: "effect-perf",
    order: 1,
    title: "Image Effect",
    tagline: "First domain effect — scan → register → benchmark → train → artifact",
    path: "examples/image-effect.md",
    accent: "#d29922",
    cardIds: ["card-image", "card-effect-image", "card-perf-harness", "card-perf-registry"],
    relatedDocs: ["docs/references/kimi-doctor.md"],
    commands: ["cd examples/dashboard && bun run perf:train", "KIMI_MODULES=image kimi-fix <path>"],
    controlPlaneLevel: 2,
  },
  {
    id: "platform-absorption",
    kind: "guide",
    lane: "effect-perf",
    order: 2,
    title: "Platform Absorption",
    tagline: "When Bun improves, thresholds tighten automatically via --train",
    path: "examples/platform-absorption.md",
    accent: "#e3b341",
    cardIds: [
      "card-perf-registry",
      "card-threshold-overrides",
      "card-perf-harness",
      "card-effect-benchmark",
    ],
    relatedDocs: ["examples/dashboard/v53/README.md"],
    commands: ["cd examples/dashboard && bun run perf:train", "kimi-doctor --perf-gates"],
    controlPlaneLevel: 2,
  },
  {
    id: "project-health-check",
    kind: "guide",
    lane: "agent-workflows",
    order: 1,
    title: "Project Health Check",
    tagline: "config:status → kimi doctor → ecosystem doctor — the polite first pass",
    path: "examples/project-health-check.md",
    accent: "#f778ba",
    cardIds: ["card-kimi-doctor", "card-gates", "card-scaffold"],
    relatedDocs: ["skills/kimi-toolchain/SKILL.md"],
    commands: ["bun run config:status", "kimi doctor", "kimi-doctor --quick"],
    controlPlaneLevel: 1,
  },
  {
    id: "what-broke",
    kind: "guide",
    lane: "agent-workflows",
    order: 2,
    title: "What Broke?",
    tagline: "Failure recovery ladder — debug last, wire, heal clusters, guardian check",
    path: "examples/what-broke.md",
    accent: "#ff7b72",
    cardIds: ["card-kimi-doctor", "card-trace-verify", "card-gates"],
    relatedDocs: ["error-taxonomy.yml"],
    commands: ["kimi-debug last", "kimi-heal plan --json", "kimi-guardian check"],
    controlPlaneLevel: 1,
  },
  {
    id: "guardian-failure",
    kind: "guide",
    lane: "agent-workflows",
    order: 3,
    title: "Guardian Failure",
    tagline: "Lockfile hash mismatch blocks push — baseline before shipping deps",
    path: "examples/guardian-failure.md",
    accent: "#ffa198",
    cardIds: ["card-gates", "card-scaffold"],
    relatedDocs: ["src/lib/bun-install-config.ts"],
    commands: ["kimi-guardian check", "kimi-guardian fix"],
    controlPlaneLevel: 3,
  },
  {
    id: "template-policy-and-scaffold",
    kind: "guide",
    lane: "agent-workflows",
    order: 4,
    title: "Template Policy & Scaffold",
    tagline:
      "bun create vs kimi-new bridge, 29-layer template gate, Bun.secrets slices, skills:table catalog",
    path: "examples/template-policy-and-scaffold.md",
    accent: "#58a6ff",
    cardIds: ["card-scaffold", "card-gates", "card-kimi-doctor"],
    relatedDocs: [
      "TEMPLATES.md",
      "skills/create-template/SKILL.md",
      "docs/references/template-matrix.md",
      "templates/scaffold/skills-readme.md",
      "src/lib/template-policy-audit.ts",
    ],
    commands: [
      "bun create kimi-toolchain my-app",
      "kimi-new my-app",
      "bun run check:template-policy",
      "bun run skills:table --verbose",
    ],
    controlPlaneLevel: 1,
  },
  {
    id: "secrets-and-identity",
    kind: "guide",
    lane: "agent-workflows",
    order: 5,
    title: "Secrets & Identity",
    tagline: "Bun.secrets-first templates, kimi-secrets CLI, JWT/CSRF/session identity layer",
    path: "examples/secrets-and-identity.md",
    accent: "#f0883e",
    cardIds: ["card-identity-flow", "card-token-jwt", "card-token-csrf", "card-scaffold"],
    relatedDocs: [
      "docs/identity/secrets-registry.md",
      "examples/template-policy-and-scaffold.md",
      "templates/bun-create/herdr-service-template/src/lib/secrets/",
    ],
    commands: [
      "kimi-secrets check --json",
      "bun test test/bun-secrets-runtime.unit.test.ts",
      "bun run check:template-policy",
    ],
    controlPlaneLevel: 2,
  },
] as const;

export interface ShowcaseEntryStatus {
  present: boolean;
  runnable: boolean;
}

export interface TradingWorkspaceProbe {
  ok: boolean;
  artifactsDir: string;
  gateCount: number;
  artifactCount: number;
  cardCount?: number;
  gates: Array<{ gate: string; count: number; latest?: string }>;
  lastRunId?: string;
}

export interface DashboardProjectProbe {
  ok: boolean;
  cardCount: number;
  artifactCount?: number;
  hubCardIds: readonly string[];
  defaultPort: number;
}

export interface ArtifactPortalProbe {
  ok: boolean;
  artifactsDir: string;
  artifactCount: number;
  diagnosticsCount: number;
  manifestCount: number;
  latestDiagnostics?: string;
  latestManifest?: string;
  runner?: string;
}

export type ShowcaseProjectProbe =
  | TradingWorkspaceProbe
  | DashboardProjectProbe
  | ArtifactPortalProbe;

export interface ShowcaseEntryPayload extends ShowcaseEntry {
  status: ShowcaseEntryStatus;
  /** Lane metadata for rendering. */
  laneTitle: string;
  laneAccent: string;
  /** Live probe for runnable projects. */
  probe?: ShowcaseProjectProbe;
}

export interface ExamplesShowcaseSettings {
  port: number;
  probePort: number;
  probeHost: string;
  canonicalPort: number;
  dashboardUrl: string;
}

export interface ExamplesShowcasePayload {
  ok: boolean;
  schemaVersion: typeof EXAMPLES_SHOWCASE_SCHEMA_VERSION;
  lanes: ShowcaseLane[];
  entries: ShowcaseEntryPayload[];
  /** Reverse map: card id → showcase entry ids. */
  cardIndex: Record<string, string[]>;
  totals: { projects: number; guides: number; cardsMapped: number };
  filter: { id: string | null; example: string | null };
  /** Dashboard Contract v1.0 — resolved listen/probe ports for deep links. */
  settings: ExamplesShowcaseSettings;
  fetchedAt: string;
}

/** Rewrite legacy :3000 / :5678 open URLs to the resolved dashboard port. */
export function rewriteDashboardUrlsInText(text: string, port: number, host = "127.0.0.1"): string {
  const base = `http://${host}:${port}`;
  return text
    .replace(/http:\/\/127\.0\.0\.1:\d+/g, base)
    .replace(/http:\/\/localhost:\d+/g, `http://localhost:${port}`);
}

function laneById(id: ShowcaseLaneId): ShowcaseLane {
  const lane = SHOWCASE_LANES.find((l) => l.id === id);
  if (!lane) throw new Error(`unknown showcase lane: ${id}`);
  return lane;
}

function entryStatus(repoRoot: string, entry: ShowcaseEntry): ShowcaseEntryStatus {
  const fullPath = join(repoRoot, entry.path);
  const present = pathExists(fullPath);
  const runnable =
    entry.kind === "project" && present && pathExists(join(fullPath, "package.json"));
  return { present, runnable };
}

function uniqueCardIds(entries: readonly ShowcaseEntry[]): number {
  return new Set(entries.flatMap((e) => e.cardIds)).size;
}

/** Reverse map: dashboard card id → showcase entry ids. */
export function buildCardShowcaseIndex(
  entries: readonly ShowcaseEntry[] = SHOWCASE_ENTRIES
): Record<string, string[]> {
  const index: Record<string, string[]> = {};
  for (const entry of entries) {
    for (const cardId of entry.cardIds) {
      const list = index[cardId] ?? [];
      list.push(entry.id);
      index[cardId] = list;
    }
  }
  return index;
}

function resolveTradingArtifactsDir(repoRoot: string): string {
  const projectRoot = join(repoRoot, "examples/trading-workspace");
  const envPath = join(projectRoot, ".env");
  if (pathExists(envPath)) {
    const match = readText(envPath).match(/^\s*KIMI_ARTIFACTS_DIR\s*=\s*(\S+)/m);
    if (match?.[1]) return join(projectRoot, match[1]);
  }
  return join(projectRoot, "var/trading-artifacts");
}

function probeGateArtifactsDir(artifactsDir: string): TradingWorkspaceProbe {
  if (!pathExists(artifactsDir)) {
    return { ok: false, artifactsDir, gateCount: 0, artifactCount: 0, cardCount: 0, gates: [] };
  }

  const gates: TradingWorkspaceProbe["gates"] = [];
  let artifactCount = 0;
  let lastRunId: string | undefined;

  for (const gate of listDir(artifactsDir).sort()) {
    const gateDir = join(artifactsDir, gate);
    const files = listDir(gateDir)
      .filter((f) => f.endsWith(".json"))
      .sort();
    if (files.length === 0) continue;
    artifactCount += files.length;
    const latest = files.at(-1);
    gates.push({ gate, count: files.length, latest });
    if (gate === "gate-graph" && latest) {
      const envelope = safeParseRecord(readText(join(gateDir, latest)));
      const metadata =
        envelope && typeof envelope.metadata === "object" && envelope.metadata !== null
          ? (envelope.metadata as Record<string, unknown>)
          : undefined;
      const runId = metadata?.runId;
      if (typeof runId === "string") lastRunId = runId;
    }
  }

  return {
    ok: gates.length > 0,
    artifactsDir,
    gateCount: gates.length,
    artifactCount,
    cardCount: 0,
    gates,
    ...(lastRunId ? { lastRunId } : {}),
  };
}

/** Summarize saved trading artifacts without spawning trading-doctor. */
export function probeTradingWorkspace(repoRoot: string): TradingWorkspaceProbe {
  return probeGateArtifactsDir(resolveTradingArtifactsDir(repoRoot));
}

/** Summarize saved gate-tree artifacts for examples/gates without spawning gate-doctor. */
export function probeGatesExample(repoRoot: string): TradingWorkspaceProbe {
  return probeGateArtifactsDir(join(repoRoot, "examples/gates/var/artifacts"));
}

/** Summarize artifact-portal gate envelopes at repo root. */
export function probeArtifactPortal(repoRoot: string): ArtifactPortalProbe {
  const artifactsDir = join(repoRoot, ".kimi", "artifacts", "artifact-portal");
  if (!pathExists(artifactsDir)) {
    return {
      ok: false,
      artifactsDir,
      artifactCount: 0,
      diagnosticsCount: 0,
      manifestCount: 0,
    };
  }

  const files = listDir(artifactsDir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  let diagnosticsCount = 0;
  let manifestCount = 0;
  let latestDiagnostics: string | undefined;
  let latestManifest: string | undefined;
  let runner: string | undefined;

  for (const file of files) {
    const envelope = safeParseRecord(readText(join(artifactsDir, file)));
    const kind = envelope?.kind;
    if (kind === "artifact-portal-entry") {
      const type = envelope?.type;
      if (type === "benchmark-diagnostics") {
        diagnosticsCount += 1;
        latestDiagnostics = file;
        const payload =
          envelope && typeof envelope.payload === "object" && envelope.payload !== null
            ? (envelope.payload as Record<string, unknown>)
            : undefined;
        const r = payload?.runner;
        if (typeof r === "string") runner = r;
      } else if (type === "portal-manifest") {
        manifestCount += 1;
        latestManifest = file;
      }
    }
  }

  return {
    ok: diagnosticsCount > 0 && manifestCount > 0,
    artifactsDir,
    artifactCount: files.length,
    diagnosticsCount,
    manifestCount,
    ...(latestDiagnostics ? { latestDiagnostics } : {}),
    ...(latestManifest ? { latestManifest } : {}),
    ...(runner ? { runner } : {}),
  };
}

/** Dashboard project summary for showcase hub. */
export function probeDashboardProject(
  repoRoot: string,
  defaultPort = CANONICAL_DASHBOARD_PORT
): DashboardProjectProbe {
  const entry = getShowcaseEntry("dashboard");
  const cardCount = loadDashboardCardIds(repoRoot).length;
  return {
    ok: cardCount > 0,
    cardCount,
    artifactCount: 0,
    hubCardIds: entry?.cardIds ?? [],
    defaultPort,
  };
}

function safeParseRecord(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text) as unknown;
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function projectProbe(
  repoRoot: string,
  entry: ShowcaseEntry,
  dashboardPort: number
): ShowcaseProjectProbe | undefined {
  if (entry.kind !== "project" || !entryStatus(repoRoot, entry).runnable) return undefined;
  if (entry.id === "trading-workspace") return probeTradingWorkspace(repoRoot);
  if (entry.id === "gates") return probeGatesExample(repoRoot);
  if (entry.id === "portal") return probeArtifactPortal(repoRoot);
  if (entry.id === "dashboard") return probeDashboardProject(repoRoot, dashboardPort);
  return undefined;
}

export interface BuildExamplesShowcaseOptions {
  id?: string | null;
  settings?: ExamplesShowcaseSettings;
}

/** Build /api/examples payload with on-disk presence checks. */
export function buildExamplesShowcasePayload(
  repoRoot: string,
  options: BuildExamplesShowcaseOptions = {}
): ExamplesShowcasePayload {
  const filterId = options.id?.trim() || null;
  const source = filterId ? SHOWCASE_ENTRIES.filter((e) => e.id === filterId) : SHOWCASE_ENTRIES;
  const settings =
    options.settings ??
    ({
      port: CANONICAL_DASHBOARD_PORT,
      probePort: CANONICAL_DASHBOARD_PORT,
      probeHost: "127.0.0.1",
      canonicalPort: CANONICAL_DASHBOARD_PORT,
      dashboardUrl: `http://127.0.0.1:${CANONICAL_DASHBOARD_PORT}/`,
    } satisfies ExamplesShowcaseSettings);

  const entries = source
    .map((entry) => {
      const lane = laneById(entry.lane);
      const probe = projectProbe(repoRoot, entry, settings.port);
      const commands = entry.commands.map((command) =>
        rewriteDashboardUrlsInText(command, settings.port)
      );
      return {
        ...entry,
        commands,
        status: entryStatus(repoRoot, entry),
        laneTitle: lane.title,
        laneAccent: lane.accent,
        ...(probe ? { probe } : {}),
      };
    })
    .sort((a, b) => {
      const laneOrder = laneById(a.lane).order - laneById(b.lane).order;
      return laneOrder !== 0 ? laneOrder : a.order - b.order;
    });

  const projects = SHOWCASE_ENTRIES.filter((e) => e.kind === "project").length;
  const guides = SHOWCASE_ENTRIES.filter((e) => e.kind === "guide").length;

  return {
    ok: true,
    schemaVersion: EXAMPLES_SHOWCASE_SCHEMA_VERSION,
    lanes: [...SHOWCASE_LANES].sort((a, b) => a.order - b.order),
    entries,
    cardIndex: buildCardShowcaseIndex(SHOWCASE_ENTRIES),
    totals: {
      projects,
      guides,
      cardsMapped: uniqueCardIds(SHOWCASE_ENTRIES),
    },
    filter: { id: filterId, example: filterId },
    settings,
    fetchedAt: new Date().toISOString(),
  };
}

export function getShowcaseEntry(id: string): ShowcaseEntry | undefined {
  return SHOWCASE_ENTRIES.find((e) => e.id === id);
}

export function entriesForCard(cardId: string): ShowcaseEntry[] {
  return SHOWCASE_ENTRIES.filter((e) => e.cardIds.includes(cardId));
}

export function entriesForLane(laneId: ShowcaseLaneId): ShowcaseEntry[] {
  return SHOWCASE_ENTRIES.filter((e) => e.lane === laneId).sort((a, b) => a.order - b.order);
}

/** Lint: every mapped card id must exist in dashboard.html. */
export function lintShowcaseCardIds(repoRoot: string): string[] {
  const known = new Set(loadDashboardCardIds(repoRoot));
  const violations: string[] = [];
  for (const entry of SHOWCASE_ENTRIES) {
    for (const cardId of entry.cardIds) {
      if (!known.has(cardId)) {
        violations.push(`${entry.id}: unknown card id ${cardId}`);
      }
    }
  }
  return violations;
}
