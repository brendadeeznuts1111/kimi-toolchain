/**
 * Effect benchmark companion (manifest id benchmark).
 * Regenerate routing: bun run canvas:generate
 */
import {
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  CollapsibleSection,
  Grid,
  H1,
  H2,
  Pill,
  Row,
  Stack,
  Stat,
  Table,
  Text,
  useCanvasAction,
  useHostTheme,
} from "cursor/canvas";

const THIS_MANIFEST_ID = "benchmark";
const POLL_INTERVAL_MS = 30_000;
const PROBE_DEFAULT_PORT = 5678;

const API_SURFACE = [
  ["/api/effect-benchmark", "GET", "BenchmarkApiEnvelope from serve-probe cache"],
  ["/api/effect-benchmark/refresh", "POST", "Re-run runEffectBenchmarkCardLoop (append snapshot)"],
  ["/api/bun-test", "GET", "bun:test card + changedImportGraph mechanics"],
  ["/api/canvas-filter", "GET", "?canvas=benchmark → highlight effect-benchmark cards"],
  ["/api/cards", "GET", "?canvas=benchmark filters influenced cards on examples dashboard"],
] as const;

const PROBE_COMMAND = [
  ["CLI", "kimi-doctor --perf-gates --serve-probe"],
  ["Orchestration", "runEffectBenchmarkCardLoop() in src/lib/effect-benchmark-card.ts"],
  ["Serve-probe", "src/lib/card-probe-server.ts → GET /api/effect-benchmark"],
  ["Dashboard parity", "examples/dashboard/src/handlers/effect-benchmark.ts"],
] as const;

const ENVELOPE_FIELDS = [
  ["schemaVersion", "number", "Always 1 (BENCHMARK_API_SCHEMA_VERSION)"],
  ["runner", "string", "serve-probe | kimi-doctor | dashboard"],
  ["thresholdSource", "string", "baseline+local | local | baseline | legacy | default"],
  ["summary", "object", "total · passing · regressions · partialSuccess · timedOut"],
  ["sparklines", "Record<string, number[]>", "Per-registry-key history + current point"],
  ["gates.effectBenchmarkGate", "object", "status pass|warn|partial|fail + reason"],
  [
    "taxonomyErrors",
    "array?",
    "perf_gate_timeout · perf_handler_failure · perf_gate_partial · rate_limited",
  ],
  [
    "metadata.testExecution",
    "object?",
    "changedImportGraph — Bun --changed import-graph mechanics (portal SSOT)",
  ],
  ["metadata", "object", "trainApplied · cacheHit · timedOut · convergence · testExecution"],
] as const;

const CHANGED_IMPORT_GRAPH_PIPELINE = [
  ["1", "Git diff", "Working tree or --changed=<ref>"],
  ["2", "Import graph scan", "Static imports only; skip node_modules; no link/emit"],
  ["3", "Test selection", "Test files with transitive path to a changed file"],
  ["4", "Distribute", "--shard splits after --changed filter"],
] as const;

const INFLUENCED_CARDS = [
  [
    "card-effect-benchmark",
    "Effect Benchmark",
    "/api/effect-benchmark",
    "Shared BenchmarkApiEnvelope loop",
  ],
  ["card-perf-harness", "Perf Harness", "/api/perf-registry", "Registry + thresholds layers"],
  ["card-kimi-doctor", "kimi-doctor CLI", "/api/kimi-doctor", "--perf-gates --json parity"],
  [
    "card-bun-test",
    "bun:test",
    "/api/bun-test",
    "changedImportGraph + metadata.testExecution on envelope",
  ],
] as const;

const RELATED_PATHS = [
  ["Serve-probe doc", "docs/references/serve-probe.md"],
  ["Manifest + URLPattern", "src/canvases/benchmark.manifest.ts"],
  ["Probe client", "src/lib/benchmark-probe-client.ts"],
  ["--changed import graph", "src/lib/test-runtime.ts → BUN_TEST_CHANGED_IMPORT_GRAPH"],
  ["Test execution doc", "docs/references/testing-execution.md"],
  ["Canvas filter", "src/lib/dashboard-canvas-filter.ts"],
  ["Herdr bridge deep links", "src/lib/herdr-dashboard/server/bridge.ts"],
  ["Examples handler", "examples/dashboard/src/handlers/effect-benchmark.ts"],
] as const;

const ENFORCEMENT = [
  ["Canvas routing parity", "bun run scripts/lint-cursor-canvas.ts"],
  ["canvasInfluences lint", "bun run scripts/lint-canvas-influences.ts"],
  ["Deep-link filter", "bun test test/dashboard-canvas-filter.unit.test.ts"],
  ["Probe client", "bun test test/benchmark-manifest.unit.test.ts"],
] as const;

/** @generated canvas-routing — bun run canvas:generate; do not edit */
const CANVAS_ROUTING = [
  {
    id: "kimi-toolchain",
    page: "Hub",
    path: "docs/canvases/kimi-toolchain.canvas.tsx",
    detail: "Architecture, tools, gates — start here",
  },
  {
    id: "namespace-boundaries",
    page: "Meta / routing",
    path: "docs/canvases/namespace-boundaries.canvas.tsx",
    detail: "Doctor trinity · finish-work vs prefix+*",
  },
  {
    id: "configuration-layers",
    page: "Config SSOT",
    path: "docs/canvases/configuration-layers.canvas.tsx",
    detail: "Discovery · define · parity · scaffold layers",
  },
  {
    id: "doc-links-and-see-ladder",
    page: "Doc links",
    path: "docs/canvases/doc-links-and-see-ladder.canvas.tsx",
    detail: "@see ladder · docs/references index",
  },
  {
    id: "kimi-fix",
    page: "Scaffold",
    path: "docs/canvases/kimi-fix.canvas.tsx",
    detail: "Profiles · templates · scaffold doctor",
  },
  {
    id: "herdr-dashboard-thumbnails",
    page: "Orchestrator HTTP",
    path: "docs/canvases/herdr-dashboard-thumbnails.canvas.tsx",
    detail: "PNG → Bun.Image → /api/thumbnail",
  },
  {
    id: "herdr-dashboard-automation",
    page: "Finish-work shell",
    path: "docs/canvases/herdr-dashboard-automation.canvas.tsx",
    detail: "kimi-doctor --automation · gate JSON",
  },
  {
    id: "herdr-unified-plugin-architecture",
    page: "Herdr plugins",
    path: "docs/canvases/herdr-unified-plugin-architecture.canvas.tsx",
    detail: "prefix+* · orthogonal to finish-work gates",
  },
  {
    id: "kimi-heal-doctor-scaffold",
    page: "Effect heal + doctor",
    path: "docs/canvases/kimi-heal-doctor-scaffold.canvas.tsx",
    detail: "Effect repair · KIMI_MODULES=doctor · perf gates",
  },
  {
    id: "dashboard-card-registry",
    page: "Dashboard card registry",
    path: "docs/canvases/dashboard-card-registry.canvas.tsx",
    detail: "Canvas↔card wiring · influence coverage",
  },
  {
    id: "artifact-lineage",
    page: "Artifacts & Runs",
    path: "docs/canvases/artifact-lineage.canvas.tsx",
    detail: "Run manifests · /api/artifacts · /api/runs · lineage URLPatterns",
  },
  {
    id: "gate-health",
    page: "Gate Health",
    path: "docs/canvases/gate-health.canvas.tsx",
    detail: "GET /api/doctor/gates · #gate-health overlay · 30s poll",
  },
  {
    id: "benchmark",
    page: "Effect Benchmark",
    path: "docs/canvases/benchmark.canvas.tsx",
    detail: "manifest id benchmark (this canvas)",
  },
] as const;

/** @generated canvas-routing-meta — bun run canvas:generate; do not edit */
const CANVAS_ROUTING_COUNT = CANVAS_ROUTING.length;

const CANVAS_ROUTING_ROW_TONE = [
  "info",
  "neutral",
  "neutral",
  "warning",
  "neutral",
  "neutral",
  "neutral",
  "warning",
  "neutral",
  "neutral",
  "neutral",
  "neutral",
  "success",
] as const;
/** @generated canvas-routing-meta — bun run canvas:generate; do not edit */
const CANVAS_ROUTING_COUNT = CANVAS_ROUTING.length;

const _CANVAS_ROUTING_ROW_TONE = [
  "info",
  "neutral",
  "neutral",
  "warning",
  "neutral",
  "neutral",
  "neutral",
  "warning",
  "neutral",
  "neutral",
  "neutral",
  "neutral",
  "success",
] as const;
function CanvasLink({
  label,
  path,
  dispatch,
}: {
  label: string;
  path: string;
  dispatch: ReturnType<typeof useCanvasAction>;
}) {
  const theme = useHostTheme();
  return (
    <Button
      variant="ghost"
      onClick={() => dispatch({ type: "openFile", path })}
      style={{
        padding: 0,
        minHeight: "auto",
        height: "auto",
        color: theme.accent.primary,
        textDecoration: "underline",
        textUnderlineOffset: 2,
      }}
    >
      {label}
    </Button>
  );
}

function RelatedCanvasesTable() {
  const dispatch = useCanvasAction();
  return (
    <Stack gap={8}>
      <Table
        headers={["Canvas file", "Page", "Open when"]}
        rows={CANVAS_ROUTING.map((c) => [
          <CanvasLink
            key={`${c.id}-file`}
            label={`${c.id}.canvas.tsx`}
            path={c.path}
            dispatch={dispatch}
          />,
          c.page,
          c.detail ?? c.path,
        ])}
        rowTone={[...CANVAS_ROUTING_ROW_TONE]}
        striped
      />
      <Text tone="tertiary" size="small">
        {CANVAS_ROUTING_COUNT} doc canvases · sorted by canvasReadOrder · source:
        canonical-references.toml
      </Text>
    </Stack>
  );
}

export default function BenchmarkCanvas() {
  const dispatch = useCanvasAction();

  return (
    <Stack gap={20} style={{ padding: 24, maxWidth: 960 }}>
      <Stack gap={6}>
        <Row gap={8} align="center" wrap>
          <H1>Effect Benchmark</H1>
          <Pill tone="success">manifest: {THIS_MANIFEST_ID}</Pill>
        </Row>
        <Text tone="secondary" size="small">
          BenchmarkApiEnvelope SSOT — kimi-doctor --perf-gates, examples dashboard, and serve-probe
          share runEffectBenchmarkCardLoop(). Poll serve-probe for portal/Herdr diagnostics.
        </Text>
      </Stack>

      <Grid columns={3} gap={12}>
        <Stat value={String(API_SURFACE.length)} label="HTTP routes" tone="info" />
        <Stat value={`${POLL_INTERVAL_MS / 1000}s`} label="Suggested poll" />
        <Stat value={String(INFLUENCED_CARDS.length)} label="Influenced cards" tone="success" />
      </Grid>

      <Callout tone="info" title="Serve-probe contract">
        Start <code>kimi-doctor --perf-gates --serve-probe</code> then poll{" "}
        <code>GET http://127.0.0.1:{PROBE_DEFAULT_PORT}/api/effect-benchmark</code>. Runner is{" "}
        <code>serve-probe</code>; CLI uses <code>kimi-doctor</code>; dashboard uses{" "}
        <code>dashboard</code> — same envelope shape.
      </Callout>

      <H2>Deep link contract</H2>
      <Table
        framed
        headers={["Param", "Example", "Purpose"]}
        rows={[
          ["canvas", "benchmark", "Manifest id · BENCHMARK_URL_PATTERN"],
          ["runId", "run_*", "Optional v5.6 companion link scope"],
          ["gate", "effect-benchmark", "Optional gate filter on examples dashboard"],
        ]}
        striped
      />

      <H2>API surface</H2>
      <Table
        framed
        stickyHeader
        headers={["Route", "Method", "Purpose"]}
        rows={API_SURFACE.map((row) => [...row])}
        striped
      />

      <H2>Probe pipeline</H2>
      <Table
        framed
        headers={["Layer", "Detail"]}
        rows={PROBE_COMMAND.map((row) => [...row])}
        striped
      />

      <H2>BenchmarkApiEnvelope fields</H2>
      <Table
        framed
        headers={["Field", "Type", "Description"]}
        rows={ENVELOPE_FIELDS.map((row) => [...row])}
        striped
      />

      <H2>canvasInfluences → cards</H2>
      <Table
        framed
        headers={["Card id", "Title", "API route", "Notes"]}
        rows={INFLUENCED_CARDS.map((row) => [...row])}
        rowTone={INFLUENCED_CARDS.map(() => "neutral" as const)}
        striped
      />

      <CollapsibleSection title="Bun Import Graph Mechanics (--changed)" defaultOpen>
        <Text tone="secondary" size="small">
          Stamped on every BenchmarkApiEnvelope as{" "}
          <code>metadata.testExecution.changedImportGraph</code> and mirrored on{" "}
          <code>GET /api/bun-test</code>. Portal artifacts persist it via <code>build:portal</code>{" "}
          — not only the bun:test card HTML.
        </Text>
        <Table
          framed
          headers={["Step", "Stage", "Mechanics"]}
          rows={CHANGED_IMPORT_GRAPH_PIPELINE.map((row) => [...row])}
          striped
        />
      </CollapsibleSection>

      <CollapsibleSection title="Related repo paths" defaultOpen>
        <Table
          headers={["Topic", "Path"]}
          rows={RELATED_PATHS.map(([topic, path]) => [
            topic,
            <CanvasLink key={path} label={path} path={path} dispatch={dispatch} />,
          ])}
          striped
        />
      </CollapsibleSection>

      <CollapsibleSection title="Enforcement gates">
        <Table headers={["Gate", "Command"]} rows={ENFORCEMENT.map((row) => [...row])} striped />
      </CollapsibleSection>

      <Card>
        <CardHeader trailing={<Pill size="sm">read order 13</Pill>}>Specialist canvases</CardHeader>
        <CardBody>
          <RelatedCanvasesTable />
        </CardBody>
      </Card>
    </Stack>
  );
}
