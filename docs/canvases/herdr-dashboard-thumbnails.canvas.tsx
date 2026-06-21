import {
  BarChart,
  Callout,
  Card,
  CardBody,
  CardHeader,
  computeDAGLayout,
  CollapsibleSection,
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

const CONFIG = {
  stale_ms: 15000,
  sse_poll_ms: 5000,
  poll_hint_ms: 5000,
  persist_profile: true,
  screenshot_poll_ms: 2000,
  thumbnail_encode_w: 320,
  thumbnail_encode_h: 180,
  thumbnail_display_w: 160,
  thumbnail_display_h: 90,
  thumbnail_quality: 75,
} as const;

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
    detail: "manifest id dashboard-thumbnails (this canvas)",
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
    detail: "Run manifests · /api/artifacts · /api/runs · lineage URLPatterns",
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
  "success",
  "neutral",
  "warning",
  "neutral",
  "neutral",
  "neutral",
] as const;
/** @generated manifest-local-docs — bun run canvas:generate; do not edit */
const MANIFEST_LOCAL_DOCS_ALL = [
  { id: "agents", location: "repo root", purpose: "Toolchain agent guide" },
  {
    id: "code-references",
    location: "repo root",
    purpose: "Local coding exemplars; doc-links lint and @see ladder",
  },
  { id: "unified", location: "repo root", purpose: "Kimi Code vs kimi-toolchain matrix" },
  {
    id: "deep-quality",
    location: "repo root",
    purpose:
      "Effect-discipline floor and gate JSON shapes; kimi-heal --fix bare-promise repair and KIMI_MODULES=doctor scaffold",
  },
  {
    id: "templates",
    location: "repo root",
    purpose: "Scaffold templates — profiles, snippets, bun create flow, kimi-fix usage",
  },
  {
    id: "dashboard-thumbnails",
    location: "docs/references",
    purpose:
      "Herdr dashboard thumbnail pipeline; meta.webview; WebView dataStore vs in-memory cache",
  },
  {
    id: "kimi-doctor",
    location: "docs/references",
    purpose:
      "Dashboard automation gate (kimi-doctor --automation): CLI, JSON schema, exit codes, and failure modes",
  },
  {
    id: "serve-probe",
    location: "docs/references",
    purpose:
      "kimi-doctor --serve-probe HTTP routes, [doctor.probe] dx.config.toml, artifact list API, and Herdr tab wiring",
  },
  {
    id: "herdr-socket-saturation-protocol",
    location: "docs/references",
    purpose:
      "Herdr EAGAIN (os error 35) taxonomy, fix-socket --dry-run/--live contract, respawn protection, and Mac mini runbook",
  },
  {
    id: "namespace",
    location: "docs/references",
    purpose:
      "Toolchain vs Herdr plugin namespace; doctor trinity (kimi-doctor, herdr-doctor bin/plugin, kimi doctor); global ecosystem; finish-work vs prefix keybindings",
  },
  {
    id: "configuration-layers",
    location: "docs/references",
    purpose:
      "Four-layer model: discovery (canonical-references), define registry (constants-manifest), cross-repo parity (constants-parity.toml), app scaffold (templates/scaffold/bunfig.toml)",
  },
  {
    id: "canonical-references-system",
    location: "docs/references",
    purpose:
      "Manifest schema, generation pipeline, freshness/drift mechanics, lint layers, and consumer graph for canonical-references.json",
  },
  {
    id: "shell-spawn-choice",
    location: "docs/references",
    purpose: "invokeTool vs Bun.spawn vs governedSpawn decision matrix",
  },
  {
    id: "bun-runtime-scaffold",
    location: "docs/references",
    purpose:
      "Bun install config (bunfig.toml merge order, defaults, env vars, backend, cache/lazy install)",
  },
  {
    id: "testing-execution",
    location: "docs/references",
    purpose:
      "Four-script test execution model — selection (fast/changed/parallel/shard), distribution (file not describe), --changed safety net",
  },
  {
    id: "bun-shell-companions",
    location: "docs/references",
    purpose: "Bun $ template vs subprocess and inspect companion patterns",
  },
  {
    id: "bun-file-streaming",
    location: "docs/references",
    purpose:
      "Bun.file/Bun.write streaming decisions for configs, JSONL ledgers, large artifacts, transformed streams, and HTTP responses",
  },
  {
    id: "template-matrix",
    location: "docs/references",
    purpose:
      "Template families matrix: scaffold breakdown (22 files), bridge pattern collision resolution, runtime sync paths, profile differentiation",
  },
  {
    id: "herdr-plugin-architecture",
    location: "docs/references",
    purpose:
      "Herdr unified plugin plan v0.5.0 — prefix+* actions, STATE_DIR topology; orthogonal to [finishWork].gates",
  },
  {
    id: "v53-architecture",
    location: "docs/references",
    purpose:
      "v5.3 architecture consolidated reference: 9-file map, awk splitter, profile registry, DEFAULT_MODULES, MODULE_REGISTRY, 42-card dashboard, Herdr integration",
  },
  {
    id: "artifact-lineage",
    location: "repo root",
    purpose:
      "Run manifests, artifact lineage (dependsOn vs gate-graph), and session-scoped identity queries",
  },
  {
    id: "gate-health",
    location: "docs/references",
    purpose:
      "Live Herdr dashboard gate-health overlay — effect-gates probe, browser poll, server watch",
  },
  {
    id: "benchmark",
    location: "docs/references",
    purpose:
      "BenchmarkApiEnvelope SSOT — runEffectBenchmarkCardLoop shared by CLI, dashboard, and serve-probe",
  },
  {
    id: "agent-api",
    location: "repo root",
    purpose:
      "Effect-native agent API surface: KimiCapabilities, KimiTrace, KimiContract, DecisionLogger services — use instead of CLI shelling out inside Effect programs",
  },
  {
    id: "finish-work-close-loop",
    location: "repo root",
    purpose:
      "Finish-work close-loop architecture: gates → git → dirty check → reviewer escalation → orchestrator signal; dx.config.toml [finishWork] and [herdr.orchestrator] wiring",
  },
  {
    id: "handoff-rules",
    location: "repo root",
    purpose:
      "Herdr orchestrator handoff rules: TOML format, condition syntax (done/blocked/idle/probe:*), report-native when-clauses, and cross-workspace agent routing",
  },
  {
    id: "naming",
    location: "repo root",
    purpose:
      "CLI naming notes and deprecation register: --session-report → --effect-floor; kimi-doctor vs herdr-doctor vs kimi doctor disambiguation shortcuts",
  },
  {
    id: "canonical-references",
    location: "repo root",
    purpose: "Cached canonical ecosystem links (this manifest)",
  },
] as const;

const MANIFEST_DOCS_REFERENCES = MANIFEST_LOCAL_DOCS_ALL.filter(
  (doc) => doc.location === "docs/references"
);
const MANIFEST_DOCS_REFERENCES_COUNT = MANIFEST_DOCS_REFERENCES.length;
const MANIFEST_REPO_ROOT_COUNT = MANIFEST_LOCAL_DOCS_ALL.filter(
  (doc) => doc.location === "repo root"
).length;

const FINISH_WORK_GATES = [
  ["check:fast", "Format · lint · typecheck · unit tests"],
  ["kimi-doctor --effect-gates", "Effect discipline scan"],
  ["kimi-doctor --automation", "Thumbnail E2E — ephemeral server · no 18412"],
  ["kimi-heal effect audit", "Effect stream / tag audit"],
] as const;

const DOCTOR_THUMBNAIL_JSON = [
  ["thumbnail.ok", "GET /api/thumbnail probe pass"],
  ["thumbnail.status", "HTTP status (200 on success)"],
  ["thumbnail.contentType", "image/webp when encode succeeds"],
  ["thumbnail.cache", "x-thumbnail-cache: hit | miss"],
  ["smoke.pngBytes", "PNG bytes fed via setScreenshotPng"],
  ["failure.code", "thumbnail_unavailable | thumbnail_invalid | …"],
] as const;

const GATE_LAYERS = [
  [
    "--automation",
    "Toolchain",
    "[finishWork].gates",
    "Ephemeral WebView + setScreenshotPng one-shot · no 18412",
  ],
  [
    "--dashboard-meta",
    "Runtime",
    "Herdr orchestrator bootstrap",
    "Probes /api/meta · needs live server",
  ],
] as const;

const TEMPLATE_VS_PROFILE = [
  [
    "templates/herdr-dashboard.html",
    "UI shell",
    "#agents-body · #processes-toggle · #meta (not #meta-header)",
  ],
  ["templates/herdr-dashboard.js", "Runtime", "__HERDR_DASHBOARD_READY__ · .processes-row · SSE"],
  ["dataStore profile dir", "Browser state only", "cookies · localStorage — not PNG/WebP"],
  ["screenshotPng + TtlCache", "Server memory", "PNG cache + encoded WebP — discarded on stop"],
] as const;

const DAG_NODES = [
  { id: "webview", label: "Bun.WebView", sub: "herdr-dashboard-automation.ts" },
  { id: "png", label: "screenshot()", sub: "webview#screenshots" },
  { id: "feed", label: "PNG feed", sub: "setScreenshotPng · no encode" },
  { id: "server", label: "DashboardServer", sub: "herdr-dashboard-server.ts" },
  { id: "encode", label: "await .blob()", sub: "bun-image.ts · #terminals" },
  { id: "meta", label: "/api/meta", sub: ".placeholder() LQIP" },
  { id: "thumbnail", label: "/api/thumbnail", sub: "TtlCache · Response(bytes)" },
  { id: "display", label: "wireAgentThumbnail", sub: "WebView document · no encode" },
];

const DAG_EDGES = [
  { from: "webview", to: "png" },
  { from: "png", to: "feed" },
  { from: "feed", to: "server" },
  { from: "server", to: "encode" },
  { from: "encode", to: "meta" },
  { from: "encode", to: "thumbnail" },
  { from: "meta", to: "display" },
  { from: "thumbnail", to: "display" },
  { from: "display", to: "webview" },
];

const TERMINAL_CALL_SITES = [
  ["bun-image.ts", "dashboardThumbnailBlob", "await .blob()", "/api/thumbnail miss"],
  ["bun-image.ts", "probeBunImageAvifEncode", "await .bytes()", "meta.thumbnailFormats.avif"],
  ["bun-image.ts", "imagePlaceholderDataUrl", "await .placeholder()", "/api/meta LQIP"],
  [
    "herdr-dashboard-automation.ts",
    "runHerdrDashboardAutomation",
    "dashboardWebpThumbnail",
    "CLI --thumbnail",
  ],
  [
    "herdr-dashboard-automation-gate.ts",
    "runDashboardAutomationGate",
    "indirect",
    "smoke feed + fetch /api/thumbnail",
  ],
  [
    "bun-image.ts",
    "(alternative)",
    "await .write(path)",
    "not used — CLI uses .blob() + Bun.write",
  ],
] as const;

const SERVER_BROWSER_SPLIT = [
  [
    "Server",
    "Bun.Image terminals (.blob / .bytes / .placeholder)",
    "setScreenshotPng feed → dashboardThumbnailBytes on GET /api/thumbnail",
  ],
  [
    "WebView document",
    "None — client does not encode",
    "fetch /api/meta → LQIP · Image() → /api/thumbnail · wireAgentThumbnail DOM",
  ],
] as const;

/** WebView document consumer — herdr-dashboard.js inside the same Bun.WebView instance */
const BROWSER_CONSUMER = [
  [
    "wireAgentThumbnail",
    "templates/herdr-dashboard.js",
    "GET /api/meta → thumbnailPath + placeholder",
  ],
  ["LQIP first", "#agent-thumb img", "data.placeholder ThumbHash before full encode"],
  [
    "Full fetch",
    "new Image().src = thumbUrl",
    "GET /api/thumbnail?width=160&height=90&quality=75&t=…",
  ],
  ["Live refresh", "thumbLive flag", "Later polls set img.src directly — no re-LQIP"],
] as const;

/** Co-located Bun native APIs — pairs with Bun.Image terminals per dashboard-thumbnails.md */
const BUN_API_PAIRING = [
  [
    "Bun.WebView.screenshot({ format: png })",
    "webview#screenshots",
    "webViewScreenshotBytes()",
    "only PNG input",
  ],
  [
    "Bun.serve + fetch handler",
    "runtime/image · api/http",
    "pre-encoded Response(bytes)",
    "not live pipeline",
  ],
  [
    "Bun.write(path, bytes)",
    "standalone",
    "dashboardWebpThumbnail → Bun.write",
    "current CLI --thumbnail path",
  ],
  ["Bun.write(path, bytes)", "Image terminal", "await img.write(path)", "alternative (not used)"],
  ["Bun.CryptoHasher(sha256)", "runtime/hashing", "thumbnailCacheKey()", "source + encode params"],
  ["fetch + AbortSignal.timeout", "api/fetch", "probeDashboardThumbnail()", "automation gate"],
  ["Bun.sleep", "bun-apis#bun-sleep", "WebView settle", "before screenshot"],
  ["new Response(Uint8Array | Blob)", "—", "/api/thumbnail hit and miss", "post-terminal bytes"],
  ["TtlCache (project-local)", "src/lib/cache.ts", "terminal output", "TTL 2× sse_poll_ms"],
] as const;

const PATTERNS_WE_AVOID = [
  ["new Response(imgPipeline)", "/api/thumbnail", "Encode may run synchronously on body init"],
  [
    "Could use .write() terminal",
    "CLI --thumbnail",
    "await pipeline.write(path) — single await; not used today",
  ],
  [
    "We actually use",
    "CLI --thumbnail",
    "dashboardWebpThumbnail → Uint8Array → Bun.write — bytes for cache + tests",
  ],
  [".toBase64() / .dataurl()", "LQIP", ".placeholder() yields smaller ThumbHash (~400–700 B)"],
] as const;

function PipelineDiagram() {
  const theme = useHostTheme();
  const layout = computeDAGLayout({
    nodes: DAG_NODES.map((n) => ({ id: n.id })),
    edges: DAG_EDGES,
    direction: "vertical",
    nodeWidth: 200,
    nodeHeight: 52,
    rankGap: 56,
    nodeGap: 40,
    padding: 16,
  });

  const nodeById = Object.fromEntries(DAG_NODES.map((n) => [n.id, n]));

  return (
    <div style={{ overflowX: "auto" }}>
      <svg
        width={layout.width}
        height={layout.height}
        role="img"
        aria-label="Dashboard thumbnail pipeline: WebView screenshot through PNG feed (poll or doctor smoke) to HTTP endpoints"
      >
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
              markerEnd="url(#arrow)"
            />
          );
        })}
        <defs>
          <marker
            id="arrow"
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
          return (
            <g key={pos.id}>
              <rect
                x={pos.x}
                y={pos.y}
                width={200}
                height={52}
                rx={6}
                fill={theme.fill.tertiary}
                stroke={theme.stroke.primary}
                strokeWidth={1}
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
        Source: docs/references/dashboard-thumbnails.md · closed loop: screenshot out → encode →
        fetch back into same WebView document (wireAgentThumbnail)
      </Text>
    </div>
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
        headers={["Canvas", "Page", "Detail"]}
        rows={CANVAS_ROUTING.map((c) => [
          <CanvasLink
            key={`${c.id}-file`}
            label={`${c.id}.canvas.tsx`}
            path={c.path}
            dispatch={dispatch}
          />,
          <CanvasLink key={`${c.id}-page`} label={c.page} path={c.path} dispatch={dispatch} />,
          c.detail ?? c.path,
        ])}
        rowTone={[...CANVAS_ROUTING_ROW_TONE]}
        striped
      />
      <Text tone="tertiary" size="small">
        Click Canvas or Page to open · thumbnail pipeline + Bun.Image encode path
      </Text>
    </Stack>
  );
}

export default function HerdrDashboardThumbnails() {
  const theme = useHostTheme();

  const timingCategories = [
    "Screenshot poll",
    "SSE agent poll",
    "Browser handoff poll",
    "Stale overlay",
  ];
  const timingValues = [
    CONFIG.screenshot_poll_ms,
    CONFIG.sse_poll_ms,
    CONFIG.poll_hint_ms,
    CONFIG.stale_ms,
  ];

  return (
    <Stack gap={24} style={{ padding: 24, maxWidth: 960 }}>
      <Stack gap={8}>
        <H1>Herdr Dashboard — Thumbnail & Timing</H1>
        <Text tone="secondary">
          How live WebView screenshots become compressed thumbnails served by the orchestrator
          dashboard HTTP server, and where persistent browser state lives on disk.
        </Text>
      </Stack>

      <Grid columns={4} gap={12}>
        <Stat value={`${CONFIG.stale_ms / 1000}s`} label="stale_ms threshold" />
        <Stat value={`${CONFIG.sse_poll_ms / 1000}s`} label="sse_poll_ms interval" />
        <Stat value={`${CONFIG.poll_hint_ms / 1000}s`} label="poll_hint_ms interval" />
        <Stat
          value={CONFIG.persist_profile ? "persistent*" : "ephemeral"}
          label="dataStore (config intent)"
          tone={CONFIG.persist_profile ? "success" : undefined}
        />
      </Grid>
      <Text tone="tertiary" size="small">
        *persist_profile = config intent for --webview shell only. kimi-doctor --automation always
        uses ephemeral WebView (no dataStore). Headless --serve stays ephemeral until WebView opens.
      </Text>

      <Grid columns={2} gap={20}>
        <Stack gap={12}>
          <H2>Thumbnail pipeline</H2>
          <PipelineDiagram />
        </Stack>

        <Stack gap={12}>
          <H2>Polling intervals (ms)</H2>
          <BarChart
            categories={timingCategories}
            series={[{ name: "Interval (ms)", data: timingValues, tone: "info" }]}
            height={220}
            valueSuffix=" ms"
            showValues
          />
          <Text tone="tertiary" size="small">
            Source: dx.config.toml + dashboard-thumbnails.md · screenshot poll hardcoded at 2s
          </Text>
        </Stack>
      </Grid>

      <Stack gap={12}>
        <H2>Template vs profile vs thumbnail storage</H2>
        <Table
          headers={["Artifact", "Layer", "Notes"]}
          rows={TEMPLATE_VS_PROFILE.map((row) => [...row])}
          rowTone={[undefined, undefined, "warning", "info"]}
          striped
        />
        <Text tone="tertiary" size="small">
          Automation gate serves templates/herdr-dashboard.* over ephemeral server — selectors
          target template HTML/JS, not profile disk.
        </Text>
      </Stack>

      <Stack gap={12}>
        <H2>Validation gates</H2>
        <Table
          headers={["Command", "Layer", "Where", "Role"]}
          rows={GATE_LAYERS.map((row) => [...row])}
          rowTone={["success", undefined]}
          striped
        />
        <Callout tone="success" title="E2E thumbnail validation">
          kimi-doctor --automation ([finishWork].gates) spins ephemeral server, runs smoke on
          template UI, feeds setScreenshotPng, probes GET /api/thumbnail for image/webp. See
          kimi-doctor.md.
        </Callout>
        <Table
          headers={["JSON field", "Thumbnail meaning"]}
          rows={DOCTOR_THUMBNAIL_JSON.map((row) => [...row])}
          rowTone={["info", undefined, undefined, undefined, "success", "warning"]}
          striped
        />
        <Text tone="tertiary" size="small">
          Gate JSON uses dashboardAutomation object — not HerdrDashboardAutomationResult /
          orchestrator --probe fields. Cross-link: herdr-dashboard-automation canvas.
        </Text>
      </Stack>

      <Stack gap={12}>
        <H2>[finishWork].gates (dx.config.toml)</H2>
        <Table
          headers={["Gate", "Role"]}
          rows={FINISH_WORK_GATES.map((row) => [...row])}
          rowTone={[undefined, undefined, "success", undefined]}
          striped
        />
        <Text tone="tertiary" size="small">
          --dashboard-meta removed from finish-work (5fce0cb) — runtime Herdr bootstrap only.
        </Text>
      </Stack>

      <Callout tone="warning" title="Storage boundary — two separate systems">
        <Stack gap={8}>
          <Text>
            <Text weight="semibold">Disk (WebView dataStore):</Text> when{" "}
            <Text weight="semibold">persist_profile</Text> is true, Bun.WebView writes browser state
            — cookies, localStorage, session data — under{" "}
            <Text weight="semibold">~/.kimi-code/var/herdr-orchestrator-dashboard-webview/</Text>.
            Bun/WebKit manage the subdirectories; kimi-toolchain only sets the root path.
          </Text>
          <Text>
            <Text weight="semibold">Memory (dashboard server):</Text> screenshots and thumbnails
            never touch that directory. The live PNG sits in a server variable (
            <Text weight="semibold">screenshotPng</Text>); encoded WebP/AVIF bytes live in a{" "}
            <Text weight="semibold">TtlCache</Text> keyed by SHA-256 of source + dimensions + format
            (TTL ≈ 2× sse_poll_ms). Both are discarded when the server stops.
          </Text>
          <Text tone="tertiary" size="small">
            Indexed in canonical-references.json — synced to ~/.kimi-code/docs/references/ after bun
            run sync.
          </Text>
        </Stack>
      </Callout>

      <Stack gap={12}>
        <H2>meta.webview on GET /api/meta</H2>
        <Text tone="secondary" size="small">
          Browser profile block from buildDashboardMetaWebView() — separate from thumbnail fields.
        </Text>
        <Table
          headers={["Field", "Meaning"]}
          rows={[
            ["shell", "Launch mode: serve, webview, or automation"],
            ["mode", "Resolved dataStore: ephemeral or persistent"],
            ["persistProfile", "persist_profile / --persist-profile requested"],
            ["profileDir", "profile_dir or --profile-dir override when set"],
            ["directory", "Active profile path when mode is persistent"],
            ["defaultProfileDir", "~/.kimi-code/var/herdr-orchestrator-dashboard-webview"],
            ["defaultStoreName", "herdr-orchestrator-dashboard-webview"],
            ["backend", "webkit or chrome"],
          ]}
          striped
        />
        <Text tone="tertiary" size="small">
          Source: src/lib/herdr-dashboard-webview-store.ts · WebKit guard may force ephemeral when
          persistProfile is true
        </Text>
      </Stack>

      <Stack gap={12}>
        <H2>dx.config.toml — [herdr.orchestrator.dashboard]</H2>
        <Table
          headers={["Property", "Value", "Role"]}
          rows={[
            ["stale_ms", String(CONFIG.stale_ms), "Heartbeat stale overlay threshold"],
            ["sse_poll_ms", String(CONFIG.sse_poll_ms), "Server SSE agent-discovery poll"],
            ["poll_hint_ms", String(CONFIG.poll_hint_ms), "Browser handoffs/rules poll"],
            ["persist_profile", String(CONFIG.persist_profile), "Persistent WebView profile"],
          ]}
          striped
        />
        <Text tone="tertiary" size="small">
          Source: docs/table-herdr-orchestrator-dashboard.md · dx:table herdr.orchestrator.dashboard
        </Text>
      </Stack>

      <Stack gap={12}>
        <H2>HTTP API surface</H2>
        <Text tone="secondary" size="small">
          All routes registered in herdr-dashboard-server.ts. The earlier table showed only
          thumbnail-related endpoints.
        </Text>
        <Table
          headers={["Method", "Endpoint", "Purpose"]}
          rows={[
            ["GET", "/", "Dashboard HTML shell"],
            ["GET", "/herdr-dashboard.{css,js}", "Static dashboard assets"],
            ["GET", "/api/meta", "Config, webview profile, thumbnail capability, ThumbHash LQIP"],
            ["GET", "/api/thumbnail", "WebP/AVIF/JPEG/PNG encoded screenshot"],
            ["GET", "/api/agents", "Agent discovery snapshot"],
            ["GET", "/api/agents/live", "SSE live agent stream"],
            ["POST", "/api/heartbeat", "Register single agent heartbeat"],
            ["POST", "/api/heartbeats", "Batch agent heartbeats"],
            ["GET", "/api/handoffs", "Handoff history (?limit=)"],
            ["GET", "/api/rules", "Orchestrator handoff rules"],
            ["GET", "/api/widgets/logs", "Logs widget data"],
            ["GET", "/api/widgets/processes", "Processes widget data"],
            ["GET", "/api/widgets/git", "Git widget data"],
            ["POST", "/api/widgets/processes/action", "Pane process actions (kill, focus, …)"],
            ["POST", "/api/actions", "Run agent action"],
            ["POST", "/api/ipc", "Herdr IPC command bridge"],
          ]}
          rowTone={[
            undefined,
            undefined,
            "info",
            "info",
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
          ]}
          striped
        />
        <Text tone="tertiary" size="small">
          Source: src/lib/herdr-dashboard-server.ts · /api/thumbnail also returns 404 (no
          screenshot), 503 (Bun.Image unavailable), 500 (encode failed)
        </Text>
      </Stack>

      <Card>
        <CardHeader trailing={<Pill tone="info">Bun.Image #terminals</Pill>}>
          Encode pipeline
        </CardHeader>
        <CardBody>
          <Grid columns={3} gap={16}>
            <Stack gap={4}>
              <H3>Input</H3>
              <Text size="small" tone="secondary">
                PNG from Bun.WebView.screenshot() · herdr-dashboard-automation.ts
              </Text>
            </Stack>
            <Stack gap={4}>
              <H3>Terminal</H3>
              <Text size="small" tone="secondary">
                await .blob() in bun-image.ts — lazy until awaited; off JS thread
              </Text>
            </Stack>
            <Stack gap={4}>
              <H3>Downstream</H3>
              <Text size="small" tone="secondary">
                Bun.serve + TtlCache · CLI: bytes + Bun.write (not Image .write())
              </Text>
            </Stack>
          </Grid>
          <Grid columns={3} gap={16} style={{ marginTop: 12 }}>
            <Stack gap={4}>
              <H3>Default encode</H3>
              <Text size="small" tone="secondary">
                {CONFIG.thumbnail_encode_w}×{CONFIG.thumbnail_encode_h} fit inside, WebP default
              </Text>
            </Stack>
            <Stack gap={4}>
              <H3>Frontend display</H3>
              <Text size="small" tone="secondary">
                {CONFIG.thumbnail_display_w}×{CONFIG.thumbnail_display_h} q
                {CONFIG.thumbnail_quality} with cache-busting timestamp
              </Text>
            </Stack>
          </Grid>
          <Row gap={8} style={{ marginTop: 16, flexWrap: "wrap" }}>
            <Pill tone="neutral">WebP always available</Pill>
            <Pill tone="neutral">AVIF via Accept header</Pill>
            <Pill tone="warning">AVIF falls back on Linux</Pill>
            <Pill tone="info">SHA-256 in-memory cache</Pill>
            <Pill tone="success">bun.com/docs/runtime/image#terminals</Pill>
            <Pill tone="neutral">.write() documented · not used</Pill>
          </Row>
        </CardBody>
      </Card>

      <Stack gap={12}>
        <H2>Terminal call sites</H2>
        <Table
          headers={["Module", "Function", "Terminal", "Consumer"]}
          rows={TERMINAL_CALL_SITES.map((row) => [...row])}
          rowTone={["info", undefined, "success", undefined]}
          striped
        />
        <Text tone="tertiary" size="small">
          PNG feed paths (feedDashboardScreenshotPng, smoke feed) defer encode to GET /api/thumbnail
        </Text>
        <Text tone="tertiary" size="small">
          Extension rule: when no .webp() / .avif() is chained and dest is a path string, extension
          determines format.
        </Text>
      </Stack>

      <Stack gap={12}>
        <H2>Server vs WebView document</H2>
        <Table
          headers={["Side", "Encode", "Consume"]}
          rows={SERVER_BROWSER_SPLIT.map((row) => [...row])}
          rowTone={["info", "success"]}
          striped
        />
        <Text tone="tertiary" size="small">
          Same Bun.WebView instance — native screenshot() out, web fetch in. No Bun.Image on the
          client.
        </Text>
      </Stack>

      <Stack gap={12}>
        <H2>WebView document consumer</H2>
        <Text tone="secondary" size="small">
          Inside <Text weight="semibold">Bun.WebView</Text>, the dashboard HTML loads{" "}
          <Text weight="semibold">templates/herdr-dashboard.js</Text> — standard web APIs only (
          <Text weight="semibold">fetch</Text>, <Text weight="semibold">Image</Text>, DOM).
        </Text>
        <Table
          headers={["Step", "Where", "What"]}
          rows={BROWSER_CONSUMER.map((row) => [...row])}
          rowTone={["info", "success", undefined, undefined]}
          striped
        />
        <Text tone="tertiary" size="small">
          Source: templates/herdr-dashboard.js wireAgentThumbnail() · display{" "}
          {CONFIG.thumbnail_display_w}×{CONFIG.thumbnail_display_h} vs encode{" "}
          {CONFIG.thumbnail_encode_w}×{CONFIG.thumbnail_encode_h}
        </Text>
      </Stack>

      <Stack gap={12}>
        <H2>Co-located Bun native APIs</H2>
        <Text tone="secondary" size="small">
          Paired with Bun.Image terminals — see docs/references/dashboard-thumbnails.md
        </Text>
        <Table
          headers={["Bun API", "Kind", "Path / terminal", "Notes"]}
          rows={BUN_API_PAIRING.map((row) => [...row])}
          rowTone={[
            "info",
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            "warning",
          ]}
          striped
        />
      </Stack>

      <Stack gap={12}>
        <H2>Patterns we intentionally avoid</H2>
        <Table
          headers={["Alternative", "Where", "Why not / what we use instead"]}
          rows={PATTERNS_WE_AVOID.map((row) => [...row])}
          rowTone={[undefined, "warning", "success", undefined]}
          striped
        />
        <Text tone="tertiary" size="small">
          Source: docs/references/dashboard-thumbnails.md — Patterns we intentionally avoid
        </Text>
      </Stack>

      <Stack gap={12}>
        <H2>When thumbnails are available</H2>
        <Text tone="secondary" size="small">
          Default launch is <Text weight="semibold">serve</Text> (headless HTTP) — no screenshot
          feed unless you add --webview, inject a screenshotProvider, call setScreenshotPng(), or
          run <Text weight="semibold">kimi-doctor --automation</Text> in CI/finish-work.
        </Text>
        <Table
          headers={["Shell mode", "Screenshot feed", "Thumbnail served", "Default?"]}
          rows={[
            ["webview", "feedDashboardScreenshotPng (2s poll)", "Yes", "—"],
            [
              "serve + doctor gate",
              "kimi-doctor --automation smoke → setScreenshotPng once",
              "Yes",
              "CI gate",
            ],
            ["serve (headless HTTP)", "Only if screenshotProvider injected", "Conditional", "yes"],
            ["any (explicit cache)", "setScreenshotPng() called regardless of shell", "Yes", "—"],
          ]}
          rowTone={["success", "success", "warning", "info"]}
          striped
        />
        <Text tone="tertiary" size="small">
          Source: bun-image.ts dashboardThumbnailFeedsActive() · herdr-dashboard-webview-store.ts
          shell ?? serve
        </Text>
      </Stack>

      <Row gap={8} style={{ flexWrap: "wrap" }}>
        <Text tone="tertiary" size="small">
          Profile path:
        </Text>
        <Text size="small" style={{ fontFamily: "monospace", color: theme.text.secondary }}>
          ~/.kimi-code/var/herdr-orchestrator-dashboard-webview/[...]
        </Text>
      </Row>
      <Text tone="tertiary" size="small">
        WebKit/Chrome profile subdirectories (cookies, localStorage) — not thumbnails.
      </Text>

      <Stack gap={12}>
        <H2>Documentation discovery</H2>
        <Text tone="secondary" size="small">
          canonical-references.json lists{" "}
          <Text weight="semibold">{MANIFEST_LOCAL_DOCS_ALL.length} localDocs</Text> ids total. The
          table below shows all of them — only{" "}
          <Text weight="semibold">{MANIFEST_DOCS_REFERENCES_COUNT}</Text> live under
          docs/references/; the other <Text weight="semibold">{MANIFEST_REPO_ROOT_COUNT}</Text> are
          repo-root files synced to ~/.kimi-code/.
        </Text>

        <Grid columns={2} gap={20}>
          <Card>
            <CardHeader trailing={<Pill tone="info">bun run sync</Pill>}>Sync pipeline</CardHeader>
            <CardBody>
              <Stack gap={6}>
                <Text size="small">1. Edit docs/references/*.md in repo</Text>
                <Text size="small">
                  2. desktop-sync.ts glob copies to ~/.kimi-code/docs/references/
                </Text>
                <Text size="small">3. Add id to [[localDocs]] in canonical-references.toml</Text>
                <Text size="small">4. bun run references:generate then bun run sync</Text>
                <Text size="small">5. Agent queries canonical-references.json by id</Text>
              </Stack>
            </CardBody>
          </Card>

          <Stack gap={8}>
            <Row gap={8} align="center" wrap>
              <Stat value={String(MANIFEST_LOCAL_DOCS_ALL.length)} label="total localDocs ids" />
              <Stat
                value={String(MANIFEST_DOCS_REFERENCES_COUNT)}
                label="under docs/references/"
                tone="info"
              />
              <Stat value={String(MANIFEST_REPO_ROOT_COUNT)} label="repo-root docs" />
            </Row>
          </Stack>
        </Grid>

        <Table
          headers={["id", "Location", "Purpose"]}
          rows={MANIFEST_LOCAL_DOCS_ALL.map((doc) => [doc.id, doc.location, doc.purpose])}
          rowTone={MANIFEST_LOCAL_DOCS_ALL.map((doc) =>
            doc.location === "docs/references" ? "info" : undefined
          )}
          striped
        />
        <Text tone="tertiary" size="small">
          Source: canonical-references.toml LOCAL_DOC_REFERENCES · blue rows = docs/references/
          subset
        </Text>

        <CollapsibleSection
          title="docs/references/ only"
          count={MANIFEST_DOCS_REFERENCES_COUNT}
          defaultOpen
        >
          <Table
            headers={["id", "Runtime path"]}
            rows={MANIFEST_DOCS_REFERENCES.map((doc) => [
              doc.id,
              `~/.kimi-code/docs/references/${doc.id}.md`,
            ])}
            rowTone={MANIFEST_DOCS_REFERENCES.map(() => "info" as const)}
            striped
          />
        </CollapsibleSection>

        <Callout tone="success" title="Manifest indexed">
          All {MANIFEST_DOCS_REFERENCES_COUNT} docs/references ids are in LOCAL_DOC_REFERENCES (part
          of {MANIFEST_LOCAL_DOCS_ALL.length} total localDocs). Regenerate with bun run
          references:generate; runtime copy updates on bun run sync.
        </Callout>

        <CollapsibleSection
          title={`Related canvases (${CANVAS_ROUTING_COUNT} manifest-backed)`}
          defaultOpen={false}
        >
          <RelatedCanvasesTable />
        </CollapsibleSection>
      </Stack>
    </Stack>
  );
}
