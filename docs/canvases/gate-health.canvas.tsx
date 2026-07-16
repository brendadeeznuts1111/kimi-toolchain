/**
 * Live gate-health companion (manifest id gate-health).
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

const THIS_MANIFEST_ID = "gate-health";
const POLL_INTERVAL_MS = 30_000;

const API_SURFACE = [
  ["/api/doctor/gates", "GET", "Effect-gates probe via kimi-doctor --effect-gates --json"],
  ["/api/metrics", "GET", "Metrics tab + gate-health context (shared poll surface)"],
  ["/api/canvas-filter", "GET", "?canvas=gate-health → highlight card-gates + card-kimi-doctor"],
  ["/api/cards", "GET", "?canvas=gate-health filters influenced cards on examples dashboard"],
] as const;

const PROBE_COMMAND = [
  ["Subprocess", "kimi-doctor --effect-gates --json --project-root <projectPath>"],
  ["Implementation", "fetchDashboardGateHealth() in src/lib/herdr-dashboard/data/data.ts"],
  ["Route", "src/lib/herdr-dashboard/server/server.ts → GET /api/doctor/gates"],
] as const;

const RESPONSE_FIELDS = [
  ["ok", "boolean", "Probe completed (doctor found and subprocess ran)"],
  ["failed", "boolean", "One or more gates are failing"],
  ["failures", "{ name, message }[]", "Failing gate names and messages"],
  ["total", "number", "Total gates in effect-gates summary"],
  ["fetchedAt", "string", "ISO timestamp"],
] as const;

const SERVER_WATCH = [
  ["gate:failed", "First failure, pass→fail, or failure-set change", "gate.failed audit"],
  ["gate:cleared", "Fail→pass transition", "gate.cleared audit"],
  ["Poll interval", "30_000 ms", "DASHBOARD_GATE_HEALTH_POLL_MS"],
  ["Disable in tests", "gateHealthWatch: false", "startHerdrDashboardServer() option"],
] as const;

const INFLUENCED_CARDS = [
  ["card-gates", "Gate Health", "/api/gates", "Execution DAG · gate registry probes"],
  ["card-kimi-doctor", "kimi-doctor CLI", "/api/kimi-doctor", "Effect-gates + doctor adapters"],
] as const;

const RELATED_PATHS = [
  ["Gate-health doc (SSOT)", "docs/references/kimi-doctor.md § Live dashboard gate-health"],
  ["Manifest + URLPattern", "src/canvases/gate-health.manifest.ts"],
  ["Canvas filter", "src/lib/dashboard-canvas-filter.ts"],
  ["Server gate watch", "src/lib/herdr-dashboard/gates/gate-watch.ts"],
  ["Herdr bridge deep links", "src/lib/herdr-dashboard/server/bridge.ts"],
  ["Browser overlay", "templates/herdr-dashboard.js → refreshGateHealthOverlay"],
  ["Examples dashboard filter", "examples/dashboard/src/handlers/canvas-cards.ts"],
] as const;

const ENFORCEMENT = [
  ["Canvas routing parity", "bun run scripts/lint-cursor-canvas.ts"],
  ["canvasInfluences lint", "bun run scripts/lint-canvas-influences.ts"],
  ["Deep-link filter", "bun test test/dashboard-canvas-filter.unit.test.ts"],
  ["Gate watch unit", "bun test test/herdr-dashboard-gate-watch.unit.test.ts"],
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
    detail: "manifest id gate-health (this canvas)",
  },
  {
    id: "benchmark",
    page: "Effect Benchmark",
    path: "docs/canvases/benchmark.canvas.tsx",
    detail: "GET /api/effect-benchmark · serve-probe · 30s poll",
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
  "success",
  "neutral",
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
  "success",
  "neutral",
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

export default function GateHealthCanvas() {
  const dispatch = useCanvasAction();

  return (
    <Stack gap={20} style={{ padding: 24, maxWidth: 960 }}>
      <Stack gap={6}>
        <Row gap={8} align="center" wrap>
          <H1>Gate Health</H1>
          <Pill tone="info">manifest: {THIS_MANIFEST_ID}</Pill>
        </Row>
        <Text tone="secondary" size="small">
          Live effect-gates probe for the Herdr dashboard — browser overlay, server watch, and
          examples-dashboard deep links. Completes the v5.5 bridged companion set with
          artifact-lineage.
        </Text>
      </Stack>

      <Grid columns={3} gap={12}>
        <Stat value={String(API_SURFACE.length)} label="HTTP routes" tone="info" />
        <Stat value={`${POLL_INTERVAL_MS / 1000}s`} label="Browser poll" />
        <Stat value={String(INFLUENCED_CARDS.length)} label="Influenced cards" tone="success" />
      </Grid>

      <Callout tone="warning" title="Runtime probe — not finish-work">
        <code>GET /api/doctor/gates</code> runs <code>kimi-doctor --effect-gates</code> against the
        dashboard <code>projectPath</code>. Distinct from <code>--automation</code>,{" "}
        <code>--dashboard-meta</code>, and finish-work gate JSON.
      </Callout>

      <H2>Deep link contract</H2>
      <Table
        framed
        headers={["Param", "Example", "Purpose"]}
        rows={[
          ["canvas", "gate-health", "Manifest id · GATE_HEALTH_URL_PATTERN"],
          ["runId", "run_*", "v5.6 companion link — latest or explicit run"],
          ["sessionId", "sess_*", "Optional Artifacts identity scope"],
          ["gate", "model-drift", "Optional gate filter on examples dashboard"],
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

      <H2>Response shape (DashboardGateCheckPayload)</H2>
      <Table
        framed
        headers={["Field", "Type", "Description"]}
        rows={RESPONSE_FIELDS.map((row) => [...row])}
        striped
      />

      <H2>Server gate watch</H2>
      <Table
        framed
        headers={["Event / knob", "When / value", "Audit"]}
        rows={SERVER_WATCH.map((row) => [...row])}
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
        <CardHeader trailing={<Pill size="sm">read order 12</Pill>}>Specialist canvases</CardHeader>
        <CardBody>
          <RelatedCanvasesTable />
        </CardBody>
      </Card>
    </Stack>
  );
}
