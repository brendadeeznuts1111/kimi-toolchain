/**
 * v5.4 canvas↔card registry companion (manifest id v53-architecture).
 * Regenerate manifest: bun run references:generate
 * Routing parity: bun run scripts/lint-cursor-canvas.ts
 */
import {
  BarChart,
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  CollapsibleSection,
  Divider,
  Grid,
  H1,
  H2,
  Pill,
  Row,
  Stack,
  Stat,
  Table,
  Text,
  PieChart,
  useCanvasAction,
  useHostTheme,
} from "cursor/canvas";

const CANVAS_PREFIX = "docs/canvases/";
const THIS_MANIFEST_ID = "v53-architecture";
const THIS_CANVAS_ID = "dashboard-card-registry";
const BUN_INSPECT_DEPTH_DOC =
  "https://bun.sh/reference/bun/BunInspectOptions/depth#bun.BunInspectOptions.depth";
const BUN_HTTPS_AGENT_OPTIONS_DOC =
  "https://bun.sh/reference/node/https/AgentOptions#node:https.AgentOptions";

const TOTAL_CARDS = 65;
const CANVAS_ROWS = 10;
const INFLUENCED_CARDS = 21;
const ORPHAN_CARDS = 44;

const MANIFEST_CANVAS_ROWS = [
  {
    manifestId: "unified",
    canvasId: "kimi-toolchain",
    influences: "card-symbols, card-gates, card-scaffold, card-build, card-bundle, card-compile",
    count: 6,
    readOrder: 1,
  },
  {
    manifestId: "namespace",
    canvasId: "namespace-boundaries",
    influences: "card-symbols, card-gates, card-kimi-doctor",
    count: 3,
    readOrder: 2,
  },
  {
    manifestId: "configuration-layers",
    canvasId: "configuration-layers",
    influences: "card-threshold-overrides, card-metrics-schema, card-global-store",
    count: 3,
    readOrder: 3,
  },
  {
    manifestId: "code-references",
    canvasId: "doc-links-and-see-ladder",
    influences: "card-inspect-table, card-file-split, card-transpiler-scan",
    count: 3,
    readOrder: 4,
  },
  {
    manifestId: "templates",
    canvasId: "kimi-fix",
    influences: "card-scaffold, card-kimi-doctor, card-gates, card-kimi-publish",
    count: 4,
    readOrder: 5,
  },
  {
    manifestId: "dashboard-thumbnails",
    canvasId: "herdr-dashboard-thumbnails",
    influences: "card-image, card-perf-harness",
    count: 2,
    readOrder: 6,
  },
  {
    manifestId: "kimi-doctor",
    canvasId: "herdr-dashboard-automation",
    influences: "card-kimi-doctor, card-gates, card-perf-harness, card-perf-registry",
    count: 4,
    readOrder: 7,
  },
  {
    manifestId: "herdr-plugin-architecture",
    canvasId: "herdr-unified-plugin-architecture",
    influences: "card-ipc-matrix, card-vm-context, card-ipc",
    count: 3,
    readOrder: 8,
  },
  {
    manifestId: "deep-quality",
    canvasId: "kimi-heal-doctor-scaffold",
    influences: "card-gates, card-effect-image, card-perf-harness, card-kimi-doctor, card-transpiler-scan",
    count: 5,
    readOrder: 9,
  },
  {
    manifestId: THIS_MANIFEST_ID,
    canvasId: THIS_CANVAS_ID,
    influences:
      "card-gates, card-kimi-doctor, card-scaffold, card-perf-harness, card-symbols, card-perf-registry",
    count: 6,
    readOrder: 10,
  },
] as const;

const CARD_GATES_MANIFESTS: ReadonlyArray<{ manifestId: string; canvasId: string }> = [
  { manifestId: "unified", canvasId: "kimi-toolchain" },
  { manifestId: "deep-quality", canvasId: "kimi-heal-doctor-scaffold" },
  { manifestId: "templates", canvasId: "kimi-fix" },
  { manifestId: "kimi-doctor", canvasId: "herdr-dashboard-automation" },
  { manifestId: "namespace", canvasId: "namespace-boundaries" },
  { manifestId: THIS_MANIFEST_ID, canvasId: THIS_CANVAS_ID },
];

const HUB_CARDS = [
  ["card-gates", "Gate Health", "/api/gates", 6],
  ["card-kimi-doctor", "kimi-doctor CLI", "/api/kimi-doctor", 5],
  ["card-perf-harness", "Perf Harness", "/api/perf-harness", 4],
  ["card-scaffold", "Scaffold", "/api/scaffold", 3],
  ["card-symbols", "Symbol Registry", "/api/symbols", 3],
  ["card-perf-registry", "Perf Registry", "/api/perf-registry", 2],
  ["card-transpiler-scan", "Transpiler.scan", "/api/transpiler-scan", 2],
] as const;

const ORPHAN_GROUPS = [
  [
    "Bun runtime",
    [
      ["card-color", "Bun.color", "/api/color"],
      ["card-console", "new Console()", "/api/console"],
      ["card-cron", "Bun.cron", "/api/cron"],
      ["card-crypto-hash", "Bun.CryptoHasher", "/api/crypto-hash"],
      ["card-dotenv", "Bun.env / .env", "/api/dotenv"],
      ["card-file-io", "Bun.write / file", "/api/file-io"],
      ["card-glob", "Bun.Glob", "/api/glob"],
      ["card-nanoseconds", "Bun.nanoseconds", "/api/nanoseconds"],
      ["card-password", "Bun.password", "/api/password"],
      ["card-peek", "Bun.peek", "/api/peek"],
      ["card-semver", "Bun.semver", "/api/inspect-table"],
      ["card-shell", "Bun Shell ($)", "/api/shell"],
      ["card-sleep", "Bun.sleep", "/api/sleep"],
      ["card-sqlite", "bun:sqlite", "/api/sqlite"],
      ["card-terminal", "Bun.Terminal", "/api/terminal"],
      ["card-transpiler", "Bun.Transpiler", "/api/transpiler"],
      ["card-tty", "TTY Detection", "/api/tty"],
      ["card-url", "URL / URLSearchParams", "/api/url"],
    ],
  ],
  [
    "Node compat",
    [
      ["card-exec", "node:child_process", "/api/exec"],
      ["card-http2", "node:http2", "/api/http2"],
      ["card-node-http", "node:http", "/api/node-http"],
      ["card-os", "node:os", "/api/os"],
      ["card-random-bytes", "node:crypto", "/api/random-bytes"],
      ["card-url-node", "node:url", "/api/url-node"],
      ["card-util-types", "node:util/types", "/api/util-types"],
    ],
  ],
  [
    "Inspect / table",
    [
      ["card-depth", "BunInspectOptions.depth", "/api/console-depth"],
      ["card-deep-equals", "Bun.deepEquals", "/api/inspect-table"],
      ["card-inspect-defaults", "inspect.defaultOptions", "/api/inspect-defaults"],
      ["card-markdown", "Markdown Rendering", "/api/markdown/html"],
    ],
  ],
  [
    "Perf / harness (unlinked)",
    [
      ["card-perf-auto-discover", "Auto-Discover", "/api/perf-auto-discover"],
      ["card-perf-threaded", "Perf Threaded", "/api/perf-threaded"],
    ],
  ],
  [
    "Toolchain probes",
    [
      ["card-bun-test", "bun:test", "/api/bun-test"],
      ["card-build-compile", "bun build --compile", "/api/build-compile"],
      ["card-deep-match", "Bun.deepMatch", "/api/deep-match"],
      ["card-extract-methods", "Extract Methods", "/api/extract-methods"],
      ["card-glob-orphan", "Glob Autophagy", "/api/glob-orphan"],
      ["card-set-headers", "setHeaders", "/api/set-headers"],
      ["card-shadow-realm", "ShadowRealm", "/api/shadow-realm"],
      ["card-spawn-sync", "Bun.spawnSync", "/api/spawn-sync"],
      ["card-stream-hash", "Stream Hash", "/api/stream-hash"],
      ["card-strip-ansi", "Bun.stripANSI", "/api/strip-ansi"],
      ["card-trace-verify", "Trace Verify", "/api/trace-verify"],
      ["card-write-smart", "Smart Write", "/api/write-smart"],
    ],
  ],
] as const;

const PIPELINE = [
  ["1", "canonical-references.json", "cursorCanvas + canvasInfluences[] per doc row"],
  ["2", "dashboard.html", "card-* panels parsed by regex (id + h2 title + fetch route)"],
  ["3", "dashboard-card-registry.ts", "buildDashboardCardRegistry() — reverse map influences → cards"],
  ["4", "lint-canvas-influences.ts", "Gate: every influence id must exist in dashboard.html"],
  ["5", "/api/cards?canvas=<id>", "Filter registry to cards influenced by that manifest row"],
] as const;

const API_SURFACE = [
  ["/api/cards", "GET", "Full registry + optional ?canvas= manifest filter"],
  [`/api/cards?canvas=${THIS_MANIFEST_ID}`, "GET", "6 cards influenced by v53-architecture row"],
  ["/api/canvases", "GET", "Canvas manifest rows from herdr-dashboard-data"],
  ["/api/gates", "GET", "Gate JSON — card-gates status derived from this payload"],
  ["/api/console-depth", "GET", "card-depth — configured console.depth + Bun.inspect depth demos"],
] as const;

/** @generated canvas-routing — bun run canvas:generate; do not edit */
const CANVAS_ROUTING = [
  { id: "kimi-toolchain", page: "Hub", path: "docs/canvases/kimi-toolchain.canvas.tsx", detail: "Architecture, tools, gates — start here" },
  { id: "namespace-boundaries", page: "Meta / routing", path: "docs/canvases/namespace-boundaries.canvas.tsx", detail: "Doctor trinity · finish-work vs prefix+*" },
  { id: "configuration-layers", page: "Config SSOT", path: "docs/canvases/configuration-layers.canvas.tsx", detail: "Discovery · define · parity · scaffold layers" },
  { id: "doc-links-and-see-ladder", page: "Doc links", path: "docs/canvases/doc-links-and-see-ladder.canvas.tsx", detail: "@see ladder · docs/references index" },
  { id: "kimi-fix", page: "Scaffold", path: "docs/canvases/kimi-fix.canvas.tsx", detail: "Profiles · templates · scaffold doctor" },
  { id: "herdr-dashboard-thumbnails", page: "Orchestrator HTTP", path: "docs/canvases/herdr-dashboard-thumbnails.canvas.tsx", detail: "PNG → Bun.Image → /api/thumbnail" },
  { id: "herdr-dashboard-automation", page: "Finish-work shell", path: "docs/canvases/herdr-dashboard-automation.canvas.tsx", detail: "kimi-doctor --automation · gate JSON" },
  { id: "herdr-unified-plugin-architecture", page: "Herdr plugins", path: "docs/canvases/herdr-unified-plugin-architecture.canvas.tsx", detail: "prefix+* · orthogonal to finish-work gates" },
  { id: "kimi-heal-doctor-scaffold", page: "Effect heal + doctor", path: "docs/canvases/kimi-heal-doctor-scaffold.canvas.tsx", detail: "Effect repair · KIMI_MODULES=doctor · perf gates" },
  { id: "dashboard-card-registry", page: "Card registry", path: "docs/canvases/dashboard-card-registry.canvas.tsx", detail: "manifest id v53-architecture (this canvas)" },
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
  "success"
] as const;
function CanvasNavButton({
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
      type="button"
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
        headers={["Canvas file", "Binding layer", "Open when"]}
        rows={CANVAS_ROUTING.map((canvas) => [
          <span key={`${canvas.id}-file`}>
            <CanvasNavButton label={`${canvas.id}.canvas.tsx`} path={canvas.path} dispatch={dispatch} />
          </span>,
          <span key={`${canvas.id}-page`}>
            <CanvasNavButton label={canvas.page} path={canvas.path} dispatch={dispatch} />
          </span>,
          canvas.detail ?? canvas.path,
        ])}
        rowTone={[...CANVAS_ROUTING_ROW_TONE]}
        striped
      />
      <Text tone="tertiary" size="small">
        Click Canvas file or Binding layer to open the SSOT · sorted by canvasReadOrder · source:
        canonical-references.ts
      </Text>
    </Stack>
  );
}

function CardGatesManifestLinks({ dispatch }: { dispatch: ReturnType<typeof useCanvasAction> }) {
  return (
    <Row gap={6} wrap>
      {CARD_GATES_MANIFESTS.map((entry) => (
        <CanvasNavButton
          key={entry.manifestId}
          label={entry.canvasId}
          path={`${CANVAS_PREFIX}${entry.canvasId}.canvas.tsx`}
          dispatch={dispatch}
        />
      ))}
    </Row>
  );
}

export default function DashboardCardRegistryCanvas() {
  const theme = useHostTheme();
  const dispatch = useCanvasAction();
  const coveragePct = Math.round((INFLUENCED_CARDS / TOTAL_CARDS) * 100);
  const orphanRows = ORPHAN_GROUPS.flatMap(([group, rows]) =>
    rows.map(([id, title, api]) => [group, id, title, api])
  );

  return (
    <Stack gap={20} style={{ padding: 24, maxWidth: 1000 }}>
      <Stack gap={6}>
        <H1>Dashboard card registry</H1>
        <Text tone="secondary" size="small">
          Manifest: {THIS_MANIFEST_ID} · SSOT: src/lib/dashboard-card-registry.ts · lint-canvas-influences.ts ·
          2026-06-19 · {CANVAS_ROWS} canvas rows · {TOTAL_CARDS} cards · regen counts via bun run
          scripts/lint-canvas-influences.ts
        </Text>
      </Stack>

      <Grid columns={4} gap={12}>
        <Stat value={String(TOTAL_CARDS)} label="Dashboard cards" />
        <Stat value={String(CANVAS_ROWS)} label="Doc canvases" tone="info" />
        <Stat value={String(INFLUENCED_CARDS)} label="Canvas-linked cards" tone="success" />
        <Stat value={String(ORPHAN_CARDS)} label="Unlinked cards" tone="warning" />
      </Grid>

      <Grid columns={2} gap={16}>
        <Card>
          <CardHeader trailing={<Pill size="sm">{coveragePct}% linked</Pill>}>
            Card coverage by canvas influence
          </CardHeader>
          <CardBody>
            <PieChart
              donut
              size={180}
              data={[
                { label: "Canvas-linked", value: INFLUENCED_CARDS, tone: "success" },
                { label: "Unlinked", value: ORPHAN_CARDS, tone: "warning" },
              ]}
            />
            <Text tone="tertiary" size="small" style={{ marginTop: 8 }}>
              Source: buildDashboardCardRegistry() · {INFLUENCED_CARDS} of {TOTAL_CARDS} cards have ≥1
              canvasInfluences entry
            </Text>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>Cards per doc canvas</CardHeader>
          <CardBody>
            <BarChart
              horizontal
              categories={MANIFEST_CANVAS_ROWS.map((c) => c.canvasId)}
              series={[
                {
                  name: "Influenced cards",
                  data: MANIFEST_CANVAS_ROWS.map((c) => c.count),
                  tone: "info",
                },
              ]}
              height={240}
              showValues
            />
            <Text tone="tertiary" size="small" style={{ marginTop: 8 }}>
              Axis: doc canvas id · Value: card count · Source: canvasInfluences[] lengths
            </Text>
          </CardBody>
        </Card>
      </Grid>

      <H2>Hub cards — most cross-referenced</H2>
      <Table
        framed
        stickyHeader
        headers={["Card id", "Title", "API route", "Influence count", "Manifest canvases"]}
        rowTone={HUB_CARDS.map((row) => (row[3] >= 4 ? "success" : row[3] >= 2 ? "info" : "neutral"))}
        rows={HUB_CARDS.map(([id, title, api, count]) => [
          id,
          title,
          api,
          String(count),
          id === "card-gates" ? (
            <CardGatesManifestLinks key="gates-links" dispatch={dispatch} />
          ) : (
            MANIFEST_CANVAS_ROWS.filter((r) => r.influences.includes(id))
              .map((r) => r.canvasId)
              .join(" · ")
          ),
        ])}
      />

      <H2>Canvas → card mapping</H2>
      <Table
        framed
        stickyHeader
        headers={["Manifest id", "Canvas id", "canvasInfluences[]"]}
        rows={MANIFEST_CANVAS_ROWS.map((row) => [row.manifestId, row.canvasId, row.influences])}
      />

      <Callout tone="info" title="BunInspectOptions.depth (card-depth)">
        Unlinked panel <code>card-depth</code> probes{" "}
        <CanvasNavButton label="/api/console-depth" path="examples/dashboard/src/index.ts" dispatch={dispatch} /> —{" "}
        <code>Bun.inspect(obj, {"{ depth }"})</code> and global <code>console.depth</code> from bunfig.toml /
        <code>--console-depth</code>. Doc: {BUN_INSPECT_DEPTH_DOC}
      </Callout>

      <Callout tone="info" title="https.AgentOptions (http-client)">
        Production TLS floor in{" "}
        <CanvasNavButton label="src/lib/http-client.ts" path="src/lib/http-client.ts" dispatch={dispatch} /> —{" "}
        <code>makeHttpClient({"{ minTLS }"})</code> passes <code>minVersion</code> to{" "}
        <code>new https.Agent({"{ minVersion }"})</code> for <code>fetch(..., {"{ agent }"})</code>. Pair with{" "}
        <code>maxVersion</code>, <code>rejectUnauthorized</code>, <code>ca</code> per Node compat. Doc:{" "}
        {BUN_HTTPS_AGENT_OPTIONS_DOC}
      </Callout>

      <CollapsibleSection title={`Unlinked cards (${ORPHAN_CARDS})`} count={ORPHAN_CARDS} defaultOpen={false}>
        <Callout tone="info" title="No lint violation">
          Unlinked cards are valid dashboard panels without a doc-canvas companion. Lint only checks that declared
          canvasInfluences ids exist in dashboard.html.
        </Callout>
        <Table
          framed
          stickyHeader
          headers={["Group", "Card id", "Title", "API route"]}
          rows={orphanRows.map((row) => [...row])}
          striped
          style={{ marginTop: 12 }}
        />
      </CollapsibleSection>

      <H2>Data pipeline</H2>
      <Table
        framed
        headers={["Step", "Artifact", "Role"]}
        rows={PIPELINE.map(([step, artifact, role]) => [step, artifact, role])}
        rowTone={PIPELINE.map((row) => (row[0] === "4" ? "success" : "neutral"))}
      />

      <Callout tone="info" title="Lint contract">
        Every LOCAL_DOC_REFERENCES row with cursorCanvas must declare canvasInfluences[]. Each influence id must
        resolve to an id="card-*" panel in examples/dashboard/src/dashboard.html. Run: bun run
        scripts/lint-canvas-influences.ts
      </Callout>

      <Callout tone="warning" title="v5.5 follow-ups (out of scope)">
        Live status probes for all cards, Herdr bridge (examples/dashboard?canvas=v53-architecture), and unified
        Herdr+examples surface — see docs/references/v53-architecture.md v5.5 table.
      </Callout>

      <Grid columns={2} gap={16}>
        <Card>
          <CardHeader>API surface</CardHeader>
          <CardBody>
            <Table headers={["Endpoint", "Method", "Behavior"]} rows={API_SURFACE.map((r) => [...r])} striped />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>Key modules</CardHeader>
          <CardBody>
            <Stack gap={8}>
              <Row gap={6} wrap>
                <Pill active>dashboard-card-registry.ts</Pill>
                <Pill>canvas-cards.ts</Pill>
                <Pill>lint-canvas-influences.ts</Pill>
              </Row>
              <Text tone="secondary" size="small">
                SSOT for parseDashboardCardsFromHtml, buildInfluenceReverseMap, fetchDashboardCardsPayload, and
                lintCanvasInfluences. Wired into bun run lint and /api/cards handler.
              </Text>
              <Divider />
              <Text tone="secondary" size="small">
                <CanvasNavButton
                  label="src/lib/dashboard-card-registry.ts"
                  path="src/lib/dashboard-card-registry.ts"
                  dispatch={dispatch}
                />{" "}
                · card-gates status derived live from /api/gates JSON
              </Text>
            </Stack>
          </CardBody>
        </Card>
      </Grid>

      <CollapsibleSection
        title={`Related canvases (${CANVAS_ROUTING_COUNT} manifest-backed)`}
        count={CANVAS_ROUTING_COUNT}
        defaultOpen={false}
      >
        <RelatedCanvasesTable />
      </CollapsibleSection>

      <Text tone="tertiary" size="small">
        Theme: {theme.kind} · Manifest: {THIS_MANIFEST_ID} · v5.4 canvas↔card wiring shipped
      </Text>
    </Stack>
  );
}
