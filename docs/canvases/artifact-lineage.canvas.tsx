/**
 * Artifact lineage + run manifests companion (manifest id artifact-lineage).
 * Regenerate routing: bun run scripts/generate-canvas-companions.ts
 */
import {
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  CollapsibleSection,
  computeDAGLayout,
  Grid,
  H1,
  H2,
  Pill,
  Row,
  Stack,
  Stat,
  Table,
  Text,
  UsageBar,
  useCanvasAction,
  useHostTheme,
} from "cursor/canvas";

const THIS_MANIFEST_ID = "artifact-lineage";

const EXEC_DAG_NODES = [
  { id: "perf", label: "perf-gate", sub: "orchestration root" },
  { id: "drift", label: "model-drift", sub: "dependsOn perf-gate" },
] as const;

const LINEAGE_DAG_NODES = [
  { id: "strat", label: "strategy-performance", sub: "upstream artifact" },
  { id: "drift-art", label: "model-drift", sub: "metadata.lineage" },
] as const;

const EXEC_DAG_EDGES = [{ from: "perf", to: "drift" }] as const;
const LINEAGE_DAG_EDGES = [{ from: "strat", to: "drift-art" }] as const;

const GRAPH_DISTINCTION = [
  [
    "Gate dependency graph",
    "What runs before what",
    "src/gates/runner.ts · kimi-doctor --gate-graph",
    "dependsOn at orchestration time",
  ],
  [
    "Artifact lineage graph",
    "What data an artifact consumed",
    "ArtifactStore metadata · --artifacts-lineage",
    "dependsOn at save time + metadata.lineage",
  ],
] as const;

const API_SURFACE = [
  ["/api/artifacts", "GET", "Per-gate summary + filterOptions · ?includeLineage=1 batch summaries"],
  ["/api/gates/graph", "GET", "Execution DAG Mermaid · ?gate= closure filter"],
  ["/api/artifacts/filter-options", "GET", "Datalist values for identity filters"],
  ["/api/artifacts/list", "GET", "?gate=<name> — entry list with identity fields"],
  ["/api/artifacts/metadata", "GET", "?gate=<name>&limit=N — indexed metadata_json collection"],
  [
    "/api/artifacts/context",
    "GET",
    "Artifact context graph · nodes include hostname/pid/lineage · convergence block",
  ],
  [
    "/api/artifact-graph",
    "GET",
    "Context + execution DAG + bunRuntimeCapabilities + Bun.Image convergence",
  ],
  ["/api/runs", "GET", "Run manifest index · same identity query params"],
  ["/api/runs/:runId", "GET", "Single run manifest + per-gate artifact envelopes"],
  ["/api/artifacts/:gate/lineage", "GET", "Declarative dependsOn resolution for a gate"],
  ["/api/artifacts/:gate/diff", "GET", "?a=&b= — envelope diff between two paths"],
  ["/api/artifacts/feed.xml", "GET", "RSS feed of recent artifacts (Herdr tab)"],
  ["/api/artifacts/index-stats", "GET", "Aggregate counts for orchestrator dashboard"],
] as const;

const IDENTITY_FIELDS = [
  ["sessionId", "Kimi Code / agent session", "card-artifacts filter + run manifest"],
  ["workspaceId", "Herdr workspace", "card-artifacts filter + run manifest"],
  ["paneId", "Herdr pane", "card-artifacts filter + run manifest"],
  ["agentId", "Spawned agent id", "card-artifacts filter + run manifest"],
  ["runId", "Finish-work or gate run manifest", "card-artifacts filter · /api/runs/:runId"],
  ["parentRunId", "Nested run linkage", "run manifest metadata only"],
] as const;

const LINEAGE_BADGES = [
  ["art:N", "badge-info / badge-ok", "Saved artifact count for mapped gate(s)"],
  ["lin:rt", "badge-ok", "lineageSource runtime — metadata.lineage from gate run"],
  ["lin:dec", "badge-info", "lineageSource declarative — dependsOn at save"],
  ["lin:str", "badge-info", "lineageSource stored — pre-rendered lineageMermaid"],
  ["lin:none", "badge-warn", "No lineage on latest artifact"],
] as const;

const INFLUENCED_CARDS = [
  [
    "card-artifacts",
    "Gate Artifacts (identity)",
    "/api/artifacts",
    "Above #card-grid · wireArtifactIdentityCard · lineage column",
  ],
  ["card-gates", "Gate Health", "/api/gates", "h2 art:N aggregate · execution DAG probes"],
  [
    "card-metrics-schema",
    "Metrics schema",
    "/api/metrics-schema",
    "h2 art:N + lin:* when metrics-schema gate saved",
  ],
  [
    "card-kimi-doctor",
    "kimi-doctor CLI",
    "/api/kimi-doctor",
    "h2 maps perf-gate · bunfig-policy · card-probe",
  ],
  [
    "card-trace-verify",
    "Trace Verify",
    "/api/trace-verify",
    "h2 maps trace-verify gate when saved",
  ],
  [
    "card-bunfig-policy",
    "Bunfig Policy",
    "/api/bunfig",
    "h2 maps bunfig-policy gate + install policy surface",
  ],
  [
    "card-url",
    "URL / Email i18n",
    "/api/url",
    "url-i18n + email-i18n probes · punycode domains · @ split octet limits",
  ],
  [
    "card-bun-runtime",
    "Bun Runtime",
    "/api/bun-runtime",
    "auditRuntimeCapabilitiesHealth · runtimeApiDocs + 13-key inventory incl. bunImage",
  ],
  [
    "card-effect-image",
    "Effect: Image",
    "/api/image",
    "Bun.Image metadata/placeholder · Herdr /api/thumbnail encode path",
  ],
] as const;

const RELATED_PATHS = [
  ["Artifact dependency graphs (SSOT)", "examples/artifact-dependency-graphs.md"],
  ["Trading L2 lineage demo", "examples/artifact-trading-loop.md"],
  ["Examples dashboard handler", "examples/dashboard/src/handlers/artifacts.ts"],
  ["Artifact store + envelopes", "src/lib/artifact-store.ts"],
  ["URLPattern routes", "src/lib/dashboard-route-patterns.ts"],
  ["Card registry override", "src/lib/dashboard-card-registry.ts → card-artifacts"],
  [
    "Identity + explorer wiring",
    "examples/dashboard/src/dashboard.html → wireArtifactIdentityCard · #card-artifacts-lineage",
  ],
  ["Batch lineage on list API", "examples/dashboard/src/handlers/artifacts.ts → ?includeLineage=1"],
  ["URL + email i18n probes", "examples/dashboard/src/index.ts → /api/url · email-i18n.ts"],
  [
    "kimi-doctor lineage CLI",
    "docs/references/kimi-doctor.md § gate-dependency-and-artifact-lineage-graphs",
  ],
] as const;

const ENFORCEMENT = [
  ["canvasInfluences lint", "bun run scripts/lint-canvas-influences.ts"],
  ["Canvas routing parity", "bun run scripts/lint-cursor-canvas.ts"],
  ["Registry unit tests", "bun test test/dashboard-card-registry.unit.test.ts"],
  ["Refresh gate artifact", "kimi-doctor --gate <name> --save-artifact"],
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
    page: "Card registry",
    path: "docs/canvases/dashboard-card-registry.canvas.tsx",
    detail: "canvasInfluences · /api/cards · lint gate",
  },
  {
    id: "artifact-lineage",
    page: "Artifacts & Runs",
    path: "docs/canvases/artifact-lineage.canvas.tsx",
    detail: "manifest id artifact-lineage (this canvas)",
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
  "success",
  "neutral",
  "neutral",
] as const;
const NODE_W = 148;
const NODE_H = 44;

function MiniDag({
  title,
  nodes,
  edges,
  caption,
}: {
  title: string;
  nodes: readonly { id: string; label: string; sub: string }[];
  edges: readonly { from: string; to: string }[];
  caption: string;
}) {
  const theme = useHostTheme();
  const nodeById = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const layout = computeDAGLayout({
    nodes: nodes.map((n) => ({ id: n.id })),
    edges: [...edges],
    direction: "vertical",
    nodeWidth: NODE_W,
    nodeHeight: NODE_H,
    rankGap: 36,
    nodeGap: 12,
    padding: 8,
  });

  return (
    <Stack gap={8}>
      <H2>{title}</H2>
      <div style={{ overflowX: "auto" }}>
        <svg width={layout.width} height={layout.height} role="img" aria-label={title}>
          {layout.edges.map((edge, i) => {
            const midY = (edge.sourceY + edge.targetY) / 2;
            const d = `M ${edge.sourceX} ${edge.sourceY} C ${edge.sourceX} ${midY}, ${edge.targetX} ${midY}, ${edge.targetX} ${edge.targetY}`;
            return (
              <path key={i} d={d} fill="none" stroke={theme.stroke.secondary} strokeWidth={1.5} />
            );
          })}
          {layout.nodes.map((pos) => {
            const node = nodeById[pos.id];
            if (!node) return null;
            const leaf = pos.id === edges[edges.length - 1]?.to;
            return (
              <g key={pos.id}>
                <rect
                  x={pos.x}
                  y={pos.y}
                  width={NODE_W}
                  height={NODE_H}
                  rx={6}
                  fill={leaf ? theme.fill.secondary : theme.fill.tertiary}
                  stroke={leaf ? theme.accent.primary : theme.stroke.primary}
                  strokeWidth={leaf ? 1.5 : 1}
                />
                <text
                  x={pos.x + NODE_W / 2}
                  y={pos.y + 16}
                  textAnchor="middle"
                  fill={theme.text.primary}
                  fontSize={10}
                  fontWeight={600}
                >
                  {node.label}
                </text>
                <text
                  x={pos.x + NODE_W / 2}
                  y={pos.y + 32}
                  textAnchor="middle"
                  fill={theme.text.tertiary}
                  fontSize={9}
                >
                  {node.sub}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <Text tone="tertiary" size="small">
        {caption}
      </Text>
    </Stack>
  );
}

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

export default function ArtifactLineageCanvas() {
  const dispatch = useCanvasAction();

  return (
    <Stack gap={20} style={{ padding: 24, maxWidth: 960 }}>
      <Stack gap={6}>
        <Row gap={8} align="center" wrap>
          <H1>Artifacts &amp; Runs</H1>
          <Pill tone="info">manifest: {THIS_MANIFEST_ID}</Pill>
        </Row>
        <Text tone="secondary" size="small">
          Run manifests, artifact lineage, and session-scoped queries — examples dashboard identity
          card + read-only HTTP APIs. Non-breaking v5.4 additive canvas row.
        </Text>
      </Stack>

      <Grid columns={3} gap={12}>
        <Stat value={String(API_SURFACE.length)} label="HTTP routes" tone="info" />
        <Stat value={String(IDENTITY_FIELDS.length)} label="Identity fields" />
        <Stat value={String(INFLUENCED_CARDS.length)} label="Influenced cards" tone="success" />
      </Grid>

      <Callout tone="info" title="Two graphs — do not conflate">
        <strong>Gate dependency</strong> answers orchestration order;{" "}
        <strong>artifact lineage</strong> answers data provenance after save. See{" "}
        <CanvasLink
          label="examples/artifact-dependency-graphs.md"
          path="examples/artifact-dependency-graphs.md"
          dispatch={dispatch}
        />
        .
      </Callout>

      <H2>Graph distinction</H2>
      <Table
        framed
        headers={["Graph", "Question", "Primary surface", "Contract"]}
        rows={GRAPH_DISTINCTION.map((row) => [...row])}
        striped
      />

      <Grid columns={2} gap={16}>
        <MiniDag
          title="Gate dependency (execution DAG)"
          nodes={EXEC_DAG_NODES}
          edges={EXEC_DAG_EDGES}
          caption="Source: examples/artifact-trading-loop.md · Y-axis: orchestration order · accent = downstream gate"
        />
        <MiniDag
          title="Artifact lineage (data provenance)"
          nodes={LINEAGE_DAG_NODES}
          edges={LINEAGE_DAG_EDGES}
          caption="Source: metadata.lineage on save · Y-axis: upstream → consumed artifact · accent = saved gate"
        />
      </Grid>

      <Stack gap={8}>
        <H2>Dashboard card coverage (canvasInfluences)</H2>
        <UsageBar
          total={INFLUENCED_CARDS.length}
          topLeftLabel="Cards with lineage wiring"
          topRightLabel={`${INFLUENCED_CARDS.length} / ${INFLUENCED_CARDS.length} mapped`}
          segments={INFLUENCED_CARDS.map((row) => ({
            id: row[0],
            value: 1,
          }))}
        />
        <Text tone="tertiary" size="small">
          Source: dashboard-card-registry.canvas.tsx · each segment = one influenced card id
        </Text>
      </Stack>

      <H2>API surface (examples dashboard)</H2>
      <Table
        framed
        stickyHeader
        headers={["Route", "Method", "Purpose"]}
        rows={API_SURFACE.map((row) => [...row])}
        striped
      />

      <H2>Identity fields</H2>
      <Table
        framed
        headers={["Field", "Scope", "Dashboard surface"]}
        rows={IDENTITY_FIELDS.map((row) => [...row])}
        striped
      />

      <H2>Lineage badges (ASCII)</H2>
      <Callout tone="neutral" title="Not Unicode icons or punycode">
        Examples dashboard uses monospace ASCII labels in <code>.lineage-badge</code> spans — same
        CSS <code>.badge-*</code> tones as other cards. Hover for full lineageSource title.
      </Callout>
      <Table
        framed
        headers={["Label", "Tone", "Meaning"]}
        rows={LINEAGE_BADGES.map((row) => [...row])}
        striped
      />

      <H2>canvasInfluences → cards</H2>
      <Table
        framed
        stickyHeader
        headers={["Card id", "Title", "API route", "Notes"]}
        rows={INFLUENCED_CARDS.map((row) => [...row])}
        rowTone={INFLUENCED_CARDS.map((row) =>
          row[0] === "card-artifacts" ? "success" : "neutral"
        )}
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
        <CardHeader trailing={<Pill size="sm">read order 11</Pill>}>Specialist canvases</CardHeader>
        <CardBody>
          <RelatedCanvasesTable />
        </CardBody>
      </Card>
    </Stack>
  );
}
