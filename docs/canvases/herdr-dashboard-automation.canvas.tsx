import {
  Callout,
  Card,
  CardBody,
  CardHeader,
  CollapsibleSection,
  computeDAGLayout,
  Grid,
  H1,
  H2,
  H3,
  Pill,
  Row,
  Stack,
  Stat,
  Table,
  Text,
  useHostTheme,
} from "cursor/canvas";

const DECISIONS = [
  ["WebView backend", "WebKit / Chrome", "WebKit", "Zero deps; matches macOS dev"],
  ["Lifecycle", "One-shot / loop / cron", "One-shot (tests)", "Loop reserved for monitoring"],
  ["Screenshot format", "PNG / JPEG / WebP", "PNG", "Lossless; Bun.WebView.screenshot() native"],
  ["Assertion style", "DOM / screenshot diff / both", "DOM + screenshot", "evaluate for state; PNG for visual"],
  ["Error handling", "Throw / log+exit1 / retry", "Throw (tests)", "log+exit1 for ops runner"],
] as const;

const EXISTING_API = [
  ["feedDashboardScreenshotPng", "herdr-dashboard-automation.ts", "2s poll loop → setScreenshotPng"],
  ["runDashboardAutomation", "herdr-dashboard-automation.ts", "Declarative DashboardAutomationAction runner"],
  ["runHerdrDashboardAutomation", "herdr-dashboard-automation.ts", "One-shot probe + optional attach click"],
  ["captureHerdrDashboardScreenshot", "herdr-dashboard-automation.ts", "CLI --screenshot entry"],
  ["waitForDashboardView", "herdr-dashboard-automation.ts", "#agents-body scroll + ready flag"],
  ["waitForSelectorCount", "herdr-dashboard-automation.ts", "Poll querySelectorAll until minCount"],
  ["waitForProcessesPanelRows", "herdr-dashboard-automation.ts", "#processes-body tr after toggle"],
  ["runDashboardAutomationSmoke", "herdr-dashboard-automation.ts", "DASHBOARD_SMOKE_ACTIONS recipe wrapper"],
  ["runDashboardAutomationGate", "herdr-dashboard-automation-gate.ts", "kimi-doctor --automation orchestration"],
  ["setScreenshotPng", "herdr-dashboard-server.ts", "In-memory cache for /api/thumbnail"],
  ["kimi-doctor --automation", "docs/references/kimi-doctor.md", "Canonical CI / finish-work gate doc"],
] as const;

const AUTOMATION_ACTIONS = [
  ["click", "selector: string", "scrollTo + view.click + settle ms"],
  ["evaluate", "script: string", "view.evaluate() → evaluations[]"],
  ["screenshot", "feed?: boolean", "PNG → setScreenshotPng when feed true"],
  ["wait", "ms: number", "Bun.sleep between steps"],
  ["waitForSelector", "selector, minCount?, timeoutMs?", "Poll querySelectorAll; throw on timeout"],
] as const;

const FIRST_SLICE = [
  ["1", "Start server + headless WebView", "startHerdrDashboardServer + Bun.WebView navigate"],
  ["2", "Wait for ready", "runDashboardAutomation waitReady → waitForDashboardView"],
  ["3", "Run recipe", "DASHBOARD_SMOKE_ACTIONS via runDashboardAutomation"],
  ["4", "Click processes panel", "{ type: click, selector: #processes-toggle }"],
  ["5", "Wait for rows", "{ type: waitForSelector, selector: #processes-body tr }"],
  ["6", "Capture + feed", "{ type: screenshot, feed: true } → setScreenshotPng"],
  ["7", "Assert cache", "runDashboardAutomationSmoke test → /api/thumbnail 200"],
  ["8", "CI / finish-work", "kimi-doctor --automation → exit 0 + dashboardAutomation JSON"],
] as const;

const FINISH_WORK_GATES = [
  ["check:fast", "Toolchain", "Format · lint · typecheck · unit tests"],
  ["kimi-doctor --effect-gates", "Toolchain", "Effect discipline scan"],
  ["kimi-doctor --automation", "Toolchain", "Self-contained — no 18412 · ownedServer: true"],
  ["kimi-heal effect audit", "Toolchain", "Effect stream / tag audit"],
] as const;

const GATE_LAYERS = [
  ["--automation", "Toolchain", "[finishWork].gates", "WebView smoke + PNG→WebP · spins ephemeral server"],
  ["--dashboard-meta", "Runtime", "Herdr orchestrator bootstrap", "Probes live /api/meta · needs 18412 or HERDR_DASHBOARD_URL"],
] as const;

const DOCTOR_GATE = [
  ["Primary", "kimi-doctor --automation", "Self-contained ephemeral server + WebView smoke"],
  ["JSON", "kimi-doctor --automation --json", "schemaVersion + tool + dashboardAutomation + summary.ok"],
  ["External URL", "--url · --dashboard-url · HERDR_DASHBOARD_URL", "UI smoke; thumbnail needs existing feed on serve shell"],
  ["Adapter (secondary)", "--adapter dashboard-automation", "Subprocess → HealthCheck[] for --all; 60s timeout"],
  ["Finish-work key", "dashboard-automation", "In [finishWork].gates — meta removed (5fce0cb)"],
] as const;

const DOCTOR_JSON_FIELDS = [
  ["ok", "boolean", "Overall pass/fail (DashboardAutomationGateResult)"],
  ["url", "string", "Dashboard base URL — not dashboardUrl"],
  ["ownedServer", "boolean", "Gate started ephemeral server (default)"],
  ["smoke.pngBytes", "number", "PNG bytes — not screenshotBytes; 0 when external --url skips feed"],
  ["smoke.bodyRowCount", "number", "#processes-body tr count"],
  ["smoke.processRowCount", "number", ".processes-row count"],
  ["thumbnail.ok", "boolean", "HTTP probe pass"],
  ["thumbnail.status", "number", "HTTP status from /api/thumbnail"],
  ["thumbnail.contentType", "string?", "image/webp on success"],
  ["thumbnail.cache", "string?", "x-thumbnail-cache: hit | miss"],
  ["failure.code", "string?", "Five codes — see table below"],
  ["failure.message", "string?", "Human-readable error"],
  ["failure.detail", "string?", "e.g. external --url cannot setScreenshotPng"],
] as const;

const PROBE_NOT_GATE = [
  ["ready", "HerdrDashboardAutomationResult / orchestrator --probe only"],
  ["agentRows", "HerdrDashboardAutomationResult / orchestrator --probe only"],
  ["screenshotBytes", "Use smoke.pngBytes on doctor gate"],
  ["thumbnailBytes", "Not emitted — probe HTTP /api/thumbnail instead"],
  ["thumbnailPath", "Not emitted"],
  ["backend", "Not in gate JSON — see /api/meta webview (dashboard-thumbnails.md)"],
  ["profile", "Ephemeral headless only — no profileDir in gate output"],
] as const;

const RELATED_SURFACES = [
  [
    "dashboard-thumbnails.md",
    "Bun.Image terminals (#terminals), .write() vs Bun.write, meta.webview profile",
  ],
  ["kimi-doctor.md", "Authoritative --automation gate CLI, JSON schema, failure codes"],
  ["namespace.md", "Doctor trinity — not herdr-doctor plugin prefix+d"],
  ["configuration-layers.md", "localDocs row kimi-doctor in canonical-references.json"],
  ["kimi-doctor --dashboard-meta", "Runtime gate — not in finish-work · Herdr bootstrap"],
  ["herdr-orchestrator dashboard --probe", "runHerdrDashboardAutomation — lower-level probe"],
] as const;

const CANVAS_ROUTING = [
  ["namespace-boundaries", "Meta / routing", "Which doctor surface? finish-work vs prefix+d vs /api/*"],
  ["herdr-dashboard-automation", "Finish-work shell", "kimi-doctor --automation · gate JSON (this canvas)"],
  ["herdr-dashboard-thumbnails", "Orchestrator HTTP", "PNG → Bun.Image → /api/thumbnail encode path"],
  ["configuration-layers", "Config layers", "Discovery localDocs vs bunfig define registry"],
] as const;

const LIFECYCLE_MODES = [
  ["Doctor gate (shipped)", "kimi-doctor --automation", "One-shot · ephemeral server · finish-work"],
  ["Monitor loop", "feedDashboardScreenshotPng", "2s poll · AbortSignal · --webview mode"],
  ["Cron / ops", "External runner", "log+exit1 on failure — reserved for monitoring"],
] as const;

const DOCTOR_FAILURE_CODES = [
  ["webview_unsupported", "Bun.WebView unavailable"],
  ["bun_image_unsupported", "Bun.Image unavailable"],
  ["smoke_failed", "Ready gate, UI action, or zero rows"],
  ["thumbnail_unavailable", "No 200 + image/webp from /api/thumbnail"],
  ["thumbnail_invalid", "200 but wrong content-type"],
] as const;

const DAG_NODES = [
  { id: "runner", label: "Automation runner", sub: "Bun script / test" },
  { id: "server", label: "DashboardServer", sub: "shell: serve · port 0 ephemeral" },
  { id: "webview", label: "Headless WebView", sub: "WebKit · navigate /" },
  { id: "ready", label: "Ready gate", sub: "#agents-body + ready flag" },
  { id: "actions", label: "UI actions", sub: "click · evaluate · wait" },
  { id: "png", label: "screenshot()", sub: "PNG Uint8Array" },
  { id: "feed", label: "setScreenshotPng", sub: "bridges serve gap" },
  { id: "doctor", label: "kimi-doctor", sub: "--automation gate" },
  { id: "thumb", label: "/api/thumbnail", sub: "await .blob() · gate fetch" },
];

const DAG_EDGES = [
  { from: "runner", to: "server" },
  { from: "runner", to: "webview" },
  { from: "webview", to: "ready" },
  { from: "ready", to: "actions" },
  { from: "actions", to: "png" },
  { from: "png", to: "feed" },
  { from: "server", to: "feed" },
  { from: "feed", to: "thumb" },
  { from: "doctor", to: "runner" },
  { from: "doctor", to: "thumb" },
];

function AutomationFlowDiagram() {
  const theme = useHostTheme();
  const layout = computeDAGLayout({
    nodes: DAG_NODES.map((n) => ({ id: n.id })),
    edges: DAG_EDGES,
    direction: "vertical",
    nodeWidth: 200,
    nodeHeight: 52,
    rankGap: 48,
    nodeGap: 32,
    padding: 12,
  });
  const nodeById = Object.fromEntries(DAG_NODES.map((n) => [n.id, n]));

  return (
    <div style={{ overflowX: "auto" }}>
      <svg width={layout.width} height={layout.height} role="img" aria-label="Dashboard automation flow">
        {layout.edges.map((edge, i) => {
          const midY = (edge.sourceY + edge.targetY) / 2;
          const d = `M ${edge.sourceX} ${edge.sourceY} C ${edge.sourceX} ${midY}, ${edge.targetX} ${midY}, ${edge.targetX} ${edge.targetY}`;
          return (
            <path
              key={i}
              d={d}
              fill="none"
              stroke={theme.stroke.secondary}
              strokeWidth={1.5}
              markerEnd="url(#auto-arrow)"
            />
          );
        })}
        <defs>
          <marker
            id="auto-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth={6}
            markerHeight={6}
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={theme.stroke.secondary} />
          </marker>
        </defs>
        {layout.nodes.map((pos) => {
          const node = nodeById[pos.id];
          if (!node) return null;
          const accent = pos.id === "feed" || pos.id === "doctor";
          return (
            <g key={pos.id}>
              <rect
                x={pos.x}
                y={pos.y}
                width={200}
                height={52}
                rx={6}
                fill={accent ? theme.fill.secondary : theme.fill.tertiary}
                stroke={accent ? theme.accent.primary : theme.stroke.primary}
                strokeWidth={accent ? 1.5 : 1}
              />
              <text
                x={pos.x + 100}
                y={pos.y + 22}
                textAnchor="middle"
                fill={theme.text.primary}
                fontSize={12}
                fontWeight={600}
              >
                {node.label}
              </text>
              <text
                x={pos.x + 100}
                y={pos.y + 38}
                textAnchor="middle"
                fill={theme.text.tertiary}
                fontSize={10}
              >
                {node.sub}
              </text>
            </g>
          );
        })}
      </svg>
      <Text tone="tertiary" size="small">
        Source: automation spec · setScreenshotPng bridges --serve (no native screenshot feed) · encode
        at GET /api/thumbnail uses await .blob() — see dashboard-thumbnails.md Terminals
      </Text>
    </div>
  );
}

export default function HerdrDashboardAutomationSpec() {
  return (
    <Stack gap={24} style={{ padding: 24, maxWidth: 960 }}>
      <Stack gap={8}>
        <H1>kimi-doctor dashboard-automation gate</H1>
        <Text tone="secondary">
          Source: docs/references/kimi-doctor.md · manifest id kimi-doctor · finish-work gate key
          dashboard-automation
        </Text>
        <Row gap={8} wrap>
          <Pill>ownedServer default</Pill>
          <Pill>no 18412 required</Pill>
          <Pill>exit 0 / 1</Pill>
          <Pill>~4s gate</Pill>
          <Pill>5 failure codes</Pill>
        </Row>
      </Stack>

      <Grid columns={3} gap={12}>
        <Stat value="no 18412" label="finish-work cold OK" tone="info" />
        <Stat value="ownedServer" label="automation default" />
        <Stat value="0/1" label="exit code pass/fail" />
      </Grid>

      <Callout tone="info" title="Toolchain vs runtime gates">
        finish-work runs --automation only (--dashboard-meta removed). Meta probes a live deployment
        after Herdr orchestrator bootstrap — not required for cold-machine finish-work.
      </Callout>

      <CollapsibleSection title="Related canvases (read order)" count={4} defaultOpen>
        <Table
          headers={["Canvas file", "Binding layer", "Open when"]}
          rows={CANVAS_ROUTING.map((r) => [...r])}
          rowTone={["info", "success", "neutral", "neutral"]}
          striped
        />
        <Text tone="tertiary" size="small">
          Read order: namespace-boundaries → this canvas (gate) → herdr-dashboard-thumbnails (encode
          DAG). configuration-layers explains localDocs discovery for kimi-doctor.md.
        </Text>
      </CollapsibleSection>

      <Stack gap={12}>
        <H2>Gate layers (5fce0cb)</H2>
        <Table
          headers={["Command", "Layer", "Where it runs", "Needs 18412?"]}
          rows={GATE_LAYERS.map((row) => [...row])}
          rowTone={["success", undefined]}
          striped
        />
        <H3>Current [finishWork].gates</H3>
        <Table
          headers={["Gate", "Layer", "Role"]}
          rows={FINISH_WORK_GATES.map((row) => [...row])}
          rowTone={[undefined, undefined, "success", undefined]}
          striped
        />
        <Text tone="tertiary" size="small">
          Source: dx.config.toml · commit 5fce0cb · docs/references/kimi-doctor.md
        </Text>
      </Stack>

      <Callout tone="info" title="Why automation exists">
        Plain --serve has no screenshot feed. Automation co-locates a headless WebView with the HTTP
        server and injects PNGs via setScreenshotPng — same path as feedDashboardScreenshotPng in
        --webview mode.
      </Callout>

      <Grid columns={2} gap={20}>
        <Stack gap={12}>
          <H2>Architecture flow</H2>
          <AutomationFlowDiagram />
        </Stack>

        <Stack gap={12}>
          <H2>Key decisions</H2>
          <Table
            headers={["Question", "Options", "Pick", "Rationale"]}
            rows={DECISIONS.map((row) => [...row])}
            striped
          />
        </Stack>
      </Grid>

      <Grid columns={2} gap={20}>
        <Stack gap={12}>
          <H2>Existing infrastructure</H2>
          <Table
            headers={["Export", "Module", "Role"]}
            rows={EXISTING_API.map((row) => [...row])}
            rowTone={["info", "info", undefined, undefined, undefined, undefined, undefined, "info", "info", "success", "success"]}
            striped
          />
          <Text tone="tertiary" size="small">
            feedDashboardScreenshotPng lives in herdr-dashboard-automation.ts (not bun-image.ts)
          </Text>
        </Stack>

        <Stack gap={12}>
          <H2>DashboardAutomationAction union</H2>
          <Card>
            <CardHeader trailing={<Pill tone="success">implemented</Pill>}>runDashboardAutomation</CardHeader>
            <CardBody>
              <Table
                headers={["type", "fields", "Maps to"]}
                rows={AUTOMATION_ACTIONS.map((row) => [...row])}
                striped
              />
            </CardBody>
          </Card>
          <Text tone="tertiary" size="small">
            executeDashboardAutomationStep dispatches each action; runDashboardAutomationSmoke uses DASHBOARD_SMOKE_ACTIONS
          </Text>
        </Stack>
      </Grid>

      <Stack gap={12}>
        <H2>kimi-doctor gate (shipped)</H2>
        <Callout tone="info" title="Canonical entry point">
          kimi-doctor --automation is primary. --adapter dashboard-automation is a secondary
          subprocess wrapper for --all — same gate, different JSON envelope (mode: adapter, checks[]).
          Exit codes: 0 pass, 1 fail only.
        </Callout>
        <Table
          headers={["Surface", "Command", "Role"]}
          rows={DOCTOR_GATE.map((row) => [...row])}
          rowTone={["info", "success", undefined, undefined, "info"]}
          striped
        />
        <Card>
          <CardHeader trailing={<Pill tone="warning">not this schema</Pill>}>
            HerdrDashboardAutomationResult
          </CardHeader>
          <CardBody>
            <Table
              headers={["Field", "Belongs to"]}
              rows={PROBE_NOT_GATE.map((row) => [...row])}
              striped
            />
          </CardBody>
        </Card>
        <Grid columns={2} gap={20}>
          <Stack gap={8}>
            <H3>dashboardAutomation JSON fields</H3>
            <Table
              headers={["Field", "Type", "Meaning"]}
              rows={DOCTOR_JSON_FIELDS.map((row) => [...row])}
              striped
            />
            <Text tone="tertiary" size="small">
              Envelope: schemaVersion 1 · tool kimi-doctor · summary.ok
            </Text>
          </Stack>
          <Stack gap={8}>
            <H3>failure.code values</H3>
            <Table
              headers={["Code", "When"]}
              rows={DOCTOR_FAILURE_CODES.map((row) => [...row])}
              striped
            />
            <H3>Related surfaces</H3>
            <Table
              headers={["Surface", "Role"]}
              rows={RELATED_SURFACES.map((row) => [...row])}
              striped
            />
          </Stack>
        </Grid>
        <Text tone="tertiary" size="small">
          Authoritative reference: docs/references/kimi-doctor.md · canonical-references id: kimi-doctor
        </Text>
      </Stack>

      <Stack gap={12}>
        <H2>Smoke recipe (implemented)</H2>
        <Table
          headers={["Step", "Action", "Implementation note"]}
          rows={FIRST_SLICE.map((row) => [...row])}
          rowTone={[
            undefined,
            "success",
            undefined,
            undefined,
            undefined,
            "info",
            "success",
            "success",
          ]}
          striped
        />
        <Text tone="tertiary" size="small">
          Source: test/herdr-dashboard-automation.unit.test.ts · test/herdr-dashboard-automation-gate.unit.test.ts
        </Text>
      </Stack>

      <Callout tone="success" title="Shipped: runner, smoke, doctor gate">
        kimi-doctor --automation — finish-work toolchain gate (~4s), ephemeral WebView, exit 0/1.
        --dashboard-meta is runtime-only (Herdr bootstrap). Profile/backend: /api/meta via meta gate.
      </Callout>

      <Card>
        <CardHeader trailing={<Pill tone="warning">spec correction</Pill>}>Selector map</CardHeader>
        <CardBody>
          <Grid columns={2} gap={16}>
            <Stack gap={4}>
              <H3>Spec draft</H3>
              <Text size="small" tone="secondary">
                #meta-header — not in dashboard HTML
              </Text>
            </Stack>
            <Stack gap={4}>
              <H3>Use instead</H3>
              <Text size="small" tone="secondary">
                #agents-body · __HERDR_DASHBOARD_READY__ · #processes-toggle · .processes-row
              </Text>
            </Stack>
          </Grid>
        </CardBody>
      </Card>

      <CollapsibleSection title="Lifecycle modes" count={3} defaultOpen={false}>
        <Table
          headers={["Mode", "Entry", "Notes"]}
          rows={LIFECYCLE_MODES.map((r) => [...r])}
          rowTone={["success", "info", "neutral"]}
          striped
        />
      </CollapsibleSection>
    </Stack>
  );
}
