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
  H3,
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

const NODE_W = 168;
const NODE_H = 44;

const DOCTOR_TRINITY = [
  ["kimi doctor", "Kimi Code CLI", "Moonshot agent config — not kimi-doctor"],
  ["kimi-doctor", "Toolchain CLI", "--automation, --effect-gates, finish-work gates"],
  ["herdr-doctor", "Toolchain bin", "DX/Herdr integration health (--json, --fix)"],
  [
    "herdr-doctor",
    "Herdr plugin v0.5.0",
    "prefix+d → herdr-doctor.status; no shared code with bin",
  ],
] as const;

/** Intent → binding layer → executable → doc. Same word ≠ same executable. */
const NAME_COLLISION_RESOLVER = [
  ["kimi doctor", "Kimi Code CLI", "~/.kimi-code/bin/kimi", "UNIFIED.md"],
  [
    "kimi-doctor --automation",
    "Finish-work shell gate",
    "~/.kimi-code/tools/kimi-doctor.ts",
    "kimi-doctor.md",
  ],
  [
    "kimi-doctor --effect-gates",
    "Finish-work shell gate",
    "~/.kimi-code/tools/kimi-doctor.ts",
    "DEEP-QUALITY.md",
  ],
  [
    "kimi-heal effect audit",
    "Finish-work shell gate",
    "~/.kimi-code/tools/kimi-heal.ts",
    "DEEP-QUALITY.md",
  ],
  [
    "herdr-doctor --json",
    "Toolchain bin (shell)",
    "src/bin/herdr-doctor.ts via PATH",
    "namespace.md",
  ],
  [
    "prefix+d",
    "Herdr plugin action",
    "herdr-doctor.status — not kimi-doctor from PATH",
    "namespace.md",
  ],
  [
    "herdr-orchestrator dashboard",
    "Toolchain bin (shell)",
    "src/bin/herdr-orchestrator.ts",
    "dashboard-thumbnails.md",
  ],
  [
    "prefix+a/l/f/t",
    "Herdr plugin action",
    "herdr-orchestrator.* plugin handlers",
    "plugin plan v0.5.0",
  ],
  [
    "GET /api/thumbnail",
    "Orchestrator HTTP",
    "Bun.serve on dashboard port",
    "dashboard-thumbnails.md",
  ],
  [
    "[[endpoints]] row",
    "dx URL inventory",
    "MCP/doc links — not dashboard HTTP",
    "endpoints-strict.schema.toml",
  ],
] as const;

const COLLISION_ROW_TONE = [
  "neutral",
  "info",
  "info",
  "info",
  "info",
  "warning",
  "info",
  "warning",
  "neutral",
  "neutral",
] as const;

/** Decision-flow table — when a task mentions a loaded word, pick the binding layer first. */
const NAME_COLLISION_DECISIONS = [
  [
    'Task says "run doctor"',
    "Is it `kimi doctor` or `kimi-doctor`?",
    "Kimi Code CLI vs finish-work shell gate",
    "UNIFIED.md · kimi-doctor.md",
  ],
  [
    'Task says "doctor in Herdr"',
    "Is it prefix+d or a shell gate string?",
    "Herdr plugin action vs toolchain bin",
    "namespace.md",
  ],
  [
    'Task says "endpoints"',
    "Is it `[[endpoints]]` or `/api/*`?",
    "dx URL inventory vs orchestrator HTTP",
    "endpoints-strict.schema.toml · dashboard-thumbnails.md",
  ],
  [
    'Task says "orchestrator"',
    "Is it CLI dashboard or prefix+a/l/f/t?",
    "Toolchain bin vs Herdr plugin action",
    "dashboard-thumbnails.md · plugin plan v0.5.0",
  ],
  [
    'Task says "finish-work gates"',
    "In dx.config.toml or a Herdr keybinding?",
    "Shell gate strings vs prefix+* actions",
    "docs/finish-work-close-loop.md · namespace.md",
  ],
] as const;

const BINDING_LAYERS = [
  ["Finish-work shell gates", "kimi-doctor --automation", "dx.config.toml [finishWork].gates"],
  ["Herdr plugin actions", "herdr-doctor.status", "~/.config/herdr/config.toml [[keys.command]]"],
  ["Orchestrator HTTP", "GET /api/meta, /api/thumbnail", "Co-located Bun.serve"],
  [
    "dx.config URL inventory",
    "[[endpoints]] MCP/doc links",
    "schemas/endpoints-strict.schema.toml (-u --exact)",
  ],
] as const;

const PRIMARY_SURFACES = [
  ["kimi-doctor", "Toolchain CLI", "Shell gate", "kimi-doctor.md"],
  ["herdr-doctor (bin)", "Integration health", "Shell", "herdr-doctor.ts"],
  ["herdr-doctor (plugin)", "Herdr sidebar", "prefix+d", "plugin plan v0.5.0"],
  ["herdr-orchestrator (CLI)", "Dashboard server", "Shell", "dashboard-thumbnails.md"],
  ["herdr-orchestrator (plugin)", "Remote agents", "prefix+a/l/f/t", "plugin plan v0.5.0"],
  ["herdr-notify", "Webhooks", "Event hooks", "plugin plan v0.5.0"],
  ["kimi-heal", "Effect audit", "Shell gate", "DEEP-QUALITY.md"],
  ["kimi-resource-governor", "Health channel subscribe", "health-listen", "health-events.jsonl"],
] as const;

const DOCS_REFERENCES = [
  ["configuration-layers", "Four-layer config model · config:status"],
  ["namespace", "Boundaries, doctor trinity, global ecosystem"],
  ["kimi-doctor", "--automation gate CLI + JSON"],
  ["dashboard-thumbnails", "WebView → Bun.Image → /api/thumbnail"],
  ["shell-spawn-choice", "invokeTool vs Bun.spawn vs governedSpawn"],
  [
    "bun-runtime-scaffold",
    "Bun install config · globalStore · execve · Bun.Terminal · using/await using",
  ],
  ["bun-shell-companions", "Bun $ template vs subprocess"],
  ["template-matrix", "22-file scaffold · bridge pattern · template families"],
  ["herdr-plugin-architecture", "Herdr plugins v0.5.0 · prefix+* · orthogonal to gates"],
] as const;

const MANIFEST_KEYS = [
  [
    "localDocs (15)",
    "id, repoPath, runtimePath, purpose",
    "Agent-indexed docs · 11 cursorCanvas pointers",
  ],
  [
    "ecosystem (8)",
    "id, name, kind, homepage, docs, usage",
    "bun, effect, kimi-code, herdr, dx, …",
  ],
  ["dx.config.toml", "[finishWork], [herdr], [[endpoints]]", "Project gates — not manifest rows"],
] as const;

/** Minimal @see tags — intent → pointer (JSDoc / agent cross-ref ladder). */
const SEE_LADDER = [
  ["Global platform / project config", "@see dx", "~/.config/dx/AGENTS.md · ecosystem id dx"],
  [
    "Gate strings in [finishWork]",
    "@see docs/references/kimi-doctor.md",
    "Shell gates only — not plugin prefix+d",
  ],
  [
    "Doctor / orchestrator name clash",
    "@see namespace-boundaries",
    "Name collision resolver · this canvas",
  ],
  [
    "Thumbnail encode path",
    "@see docs/references/dashboard-thumbnails.md",
    "Bun.Image terminals · /api/thumbnail",
  ],
  [
    "Endpoint table validation",
    "@see schemas/endpoints-strict.schema.toml",
    "dx:table -u --exact · not dashboard HTTP",
  ],
] as const;

/** When @see dx alone is enough vs when to escalate. */
const SEE_DX_VERBAGE = [
  [
    "@see dx suffices",
    "dx config · mcp-status · [finishWork] container · [herdr] layout · [[endpoints]]",
  ],
  ["@see dx not enough", "Same word, different executable (doctor, orchestrator)"],
  ["Escalate to namespace", "Shell gate vs prefix+d vs /api/* vs [[endpoints]] collision"],
  ["dx names where", "namespace names what runs"],
] as const;

/** Specialist canvases — read after namespace when binding layer is known. */
/** @generated canvas-routing — bun run canvas:generate; do not edit */
const CANVAS_ROUTING = [
  { id: "kimi-toolchain", page: "Hub", path: "docs/canvases/kimi-toolchain.canvas.tsx", detail: "Architecture, tools, gates — start here" },
  { id: "namespace-boundaries", page: "Meta / routing", path: "docs/canvases/namespace-boundaries.canvas.tsx", detail: "manifest id namespace (this canvas)" },
  { id: "configuration-layers", page: "Config SSOT", path: "docs/canvases/configuration-layers.canvas.tsx", detail: "Discovery · define · parity · scaffold layers" },
  { id: "doc-links-and-see-ladder", page: "Doc links", path: "docs/canvases/doc-links-and-see-ladder.canvas.tsx", detail: "@see ladder · docs/references index" },
  { id: "kimi-fix", page: "Scaffold", path: "docs/canvases/kimi-fix.canvas.tsx", detail: "Profiles · templates · scaffold doctor" },
  { id: "herdr-dashboard-thumbnails", page: "Orchestrator HTTP", path: "docs/canvases/herdr-dashboard-thumbnails.canvas.tsx", detail: "PNG → Bun.Image → /api/thumbnail" },
  { id: "herdr-dashboard-automation", page: "Finish-work shell", path: "docs/canvases/herdr-dashboard-automation.canvas.tsx", detail: "kimi-doctor --automation · gate JSON" },
  { id: "herdr-unified-plugin-architecture", page: "Herdr plugins", path: "docs/canvases/herdr-unified-plugin-architecture.canvas.tsx", detail: "prefix+* · orthogonal to finish-work gates" },
  { id: "kimi-heal-doctor-scaffold", page: "Effect heal + doctor", path: "docs/canvases/kimi-heal-doctor-scaffold.canvas.tsx", detail: "Effect repair · KIMI_MODULES=doctor · perf gates" },
  { id: "dashboard-card-registry", page: "Card registry", path: "docs/canvases/dashboard-card-registry.canvas.tsx", detail: "canvasInfluences · /api/cards · lint gate" },
  { id: "artifact-lineage", page: "Artifacts & Runs", path: "docs/canvases/artifact-lineage.canvas.tsx", detail: "Run manifests · /api/artifacts · /api/runs · lineage URLPatterns" },
] as const;

/** @generated canvas-routing-meta — bun run canvas:generate; do not edit */
const CANVAS_ROUTING_COUNT = CANVAS_ROUTING.length;

const CANVAS_ROUTING_ROW_TONE = [
  "info",
  "success",
  "neutral",
  "warning",
  "neutral",
  "neutral",
  "neutral",
  "warning",
  "neutral",
  "neutral",
  "neutral"
] as const;
const DAG_NODES = [
  { id: "dx", label: "dx platform", sub: "~/.config/dx/" },
  { id: "dxToml", label: "dx.config.toml", sub: "project config" },
  { id: "gates", label: "finishWork gates", sub: "shell strings" },
  { id: "herdrKeys", label: "Herdr prefix+*", sub: "plugin actions" },
  { id: "http", label: "/api/meta · /api/thumbnail", sub: "Bun.serve" },
  { id: "endpoints", label: "[[endpoints]]", sub: "URL inventory" },
  { id: "manifest", label: "canonical-references.json", sub: "localDocs + ecosystem" },
  { id: "namespaceDoc", label: "namespace.md", sub: "agent hub doc" },
] as const;

const DAG_EDGES = [
  { from: "dx", to: "dxToml" },
  { from: "dxToml", to: "gates" },
  { from: "dxToml", to: "endpoints" },
  { from: "manifest", to: "namespaceDoc" },
  { from: "herdrKeys", to: "namespaceDoc" },
  { from: "gates", to: "namespaceDoc" },
  { from: "http", to: "namespaceDoc" },
] as const;

const DOCS_REF_COUNT = DOCS_REFERENCES.length;
const LOCAL_DOCS_COUNT = 15;
const ECOSYSTEM_COUNT = 8;
const DOCS_REFS_IN_CANVAS = 9;

function BindingLayerDag() {
  const theme = useHostTheme();
  const nodeById = Object.fromEntries(DAG_NODES.map((n) => [n.id, n]));
  const layout = computeDAGLayout({
    nodes: DAG_NODES.map((n) => ({ id: n.id })),
    edges: [...DAG_EDGES],
    direction: "vertical",
    nodeWidth: NODE_W,
    nodeHeight: NODE_H,
    rankGap: 48,
    nodeGap: 20,
    padding: 12,
  });

  return (
    <div style={{ overflowX: "auto" }}>
      <svg
        width={layout.width}
        height={layout.height}
        role="img"
        aria-label="Binding layers flow to namespace.md hub"
      >
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
          const hub = pos.id === "namespaceDoc";
          return (
            <g key={pos.id}>
              <rect
                x={pos.x}
                y={pos.y}
                width={NODE_W}
                height={NODE_H}
                rx={6}
                fill={hub ? theme.fill.secondary : theme.fill.tertiary}
                stroke={hub ? theme.accent.primary : theme.stroke.primary}
                strokeWidth={hub ? 1.5 : 1}
              />
              <text
                x={pos.x + NODE_W / 2}
                y={pos.y + 18}
                textAnchor="middle"
                fill={theme.text.primary}
                fontSize={11}
                fontWeight={600}
              >
                {node.label}
              </text>
              <text
                x={pos.x + NODE_W / 2}
                y={pos.y + 34}
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
      <Text tone="tertiary" size="small">
        Source: docs/references/namespace.md · accent node = manifest id namespace
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
        headers={["Canvas file", "Binding layer", "Repo path"]}
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
        Click Canvas file or Binding layer to open · read order: namespace-boundaries → pick layer
      </Text>
    </Stack>
  );
}

export default function NamespaceBoundariesCanvas() {
  return (
    <Stack gap={20} style={{ padding: 24, maxWidth: 960 }}>
      <Stack gap={8}>
        <H1>Namespace boundaries — toolchain vs Herdr</H1>
        <Text tone="secondary">
          Source: docs/references/namespace.md · manifest id namespace · kimi-toolchain session
          parity
        </Text>
        <Row gap={8} wrap>
          <Pill>4 binding layers</Pill>
          <Pill>4 doctor surfaces</Pill>
          <Pill>{NAME_COLLISION_DECISIONS.length} decision rows</Pill>
          <Pill>{DOCS_REF_COUNT} docs/references</Pill>
          <Pill>{LOCAL_DOCS_COUNT} localDocs</Pill>
          <Pill>{ECOSYSTEM_COUNT} ecosystem stacks</Pill>
        </Row>
      </Stack>

      <Grid columns={4} gap={12}>
        <Stat label="Doctor trinity" value="4" tone="info" />
        <Stat label="Primary surfaces" value="8" />
        <Stat label="Finish-work gates" value="4" />
        <Stat label="Plugin-plan gaps" value="8" tone="warning" />
      </Grid>

      <Callout tone="warning" title="Same word ≠ same executable">
        doctor, orchestrator, and endpoints appear in Kimi Code, shell gates, Herdr prefix+*
        keybindings, orchestrator HTTP, and dx.config [[endpoints]] — pick the row in the resolver
        before editing config or docs.
      </Callout>

      <Card>
        <CardHeader trailing={<Pill size="sm">{NAME_COLLISION_RESOLVER.length} rows</Pill>}>
          Name collision resolver
        </CardHeader>
        <CardBody style={{ padding: 0 }}>
          <Table
            headers={["You see / task mentions", "Binding layer", "Actually runs", "Read"]}
            rows={NAME_COLLISION_RESOLVER.map((r) => [...r])}
            rowTone={[...COLLISION_ROW_TONE]}
            striped
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader trailing={<Pill size="sm">{NAME_COLLISION_DECISIONS.length} rows</Pill>}>
          Name collision decision table
        </CardHeader>
        <CardBody style={{ padding: 0 }}>
          <Table
            headers={["Cue", "First question", "Binding layer", "Read"]}
            rows={NAME_COLLISION_DECISIONS.map((r) => [...r])}
            rowTone={["info", "info", "warning", "warning", "info"]}
            striped
          />
        </CardBody>
      </Card>

      <Callout tone="info" title="Manifest vs doc">
        localDocs row keys: id, repoPath, runtimePath, purpose — no dx.config.toml key. The manifest
        indexes namespace.md; the doc describes trinity, gates, and prefix keybindings.
      </Callout>

      <Grid columns={2} gap={16}>
        <Card>
          <CardHeader trailing={<Pill size="sm">@see ladder</Pill>}>Cross-ref by intent</CardHeader>
          <CardBody style={{ padding: 0 }}>
            <Table
              headers={["Intent", "Minimal @see", "Resolves to"]}
              rows={SEE_LADDER.map((r) => [...r])}
              rowTone={["neutral", "info", "info", "neutral", "neutral"]}
              striped
            />
          </CardBody>
        </Card>

        <Stack gap={12}>
          <H2>@see dx — when it is enough</H2>
          <Table headers={["Rule", "Meaning"]} rows={SEE_DX_VERBAGE.map((r) => [...r])} striped />
          <Text tone="tertiary" size="small">
            dx is ecosystem id (separate codebase) — not a localDocs row. It owns config plumbing;
            namespace owns vocabulary inside that config.
          </Text>
        </Stack>
      </Grid>

      <CollapsibleSection
        title={`Related canvases (${CANVAS_ROUTING_COUNT} manifest-backed)`}
        defaultOpen
      >
        <RelatedCanvasesTable />
      </CollapsibleSection>

      <Card>
        <CardHeader trailing={<Pill size="sm">4 surfaces</Pill>}>
          Doctor trinity (+ Kimi Code)
        </CardHeader>
        <CardBody style={{ padding: 0 }}>
          <Table
            headers={["Surface", "Kind", "One-line role"]}
            rows={DOCTOR_TRINITY.map((r) => [...r])}
            rowTone={["neutral", "info", "info", "warning"]}
            striped
          />
        </CardBody>
      </Card>

      <Grid columns={2} gap={16}>
        <Card>
          <CardHeader trailing={<Pill size="sm">no collision</Pill>}>Binding layers</CardHeader>
          <CardBody style={{ padding: 0 }}>
            <Table
              headers={["Layer", "Example", "Config / gate"]}
              rows={BINDING_LAYERS.map((r) => [...r])}
              rowTone={["info", "warning", "neutral", "neutral"]}
              striped
            />
          </CardBody>
        </Card>

        <Stack gap={12}>
          <H2>Invoke flow</H2>
          <Text tone="secondary" size="small">
            Config sources and invoke surfaces converge on namespace.md — the agent-indexed hub doc.
          </Text>
          <BindingLayerDag />
        </Stack>
      </Grid>

      <CollapsibleSection title="Primary disambiguation table (8 rows)" defaultOpen={false}>
        <Table
          headers={["Namespace", "What", "Binding", "Documented in"]}
          rows={PRIMARY_SURFACES.map((r) => [...r])}
          striped
        />
      </CollapsibleSection>

      <Grid columns={2} gap={16}>
        <Card>
          <CardHeader trailing={<Pill size="sm">{DOCS_REFS_IN_CANVAS} ids</Pill>}>
            docs/references/ index
          </CardHeader>
          <CardBody style={{ padding: 0 }}>
            <Table
              headers={["Manifest id", "Purpose"]}
              rows={DOCS_REFERENCES.map((r) => [...r])}
              rowTone={DOCS_REFERENCES.map((r) =>
                r[0] === "namespace" ||
                r[0] === "configuration-layers" ||
                r[0] === "template-matrix"
                  ? "info"
                  : "neutral"
              )}
              striped
            />
          </CardBody>
        </Card>

        <Stack gap={12}>
          <H2>Manifest shape vs project config</H2>
          <Table
            headers={["Artifact", "Keys / sections", "Notes"]}
            rows={MANIFEST_KEYS.map((r) => [...r])}
            striped
          />
          <H3>localDocs by location</H3>
          <UsageBar
            total={LOCAL_DOCS_COUNT}
            topLeftLabel={`${DOCS_REFS_IN_CANVAS} under docs/references/`}
            topRightLabel={`${LOCAL_DOCS_COUNT - DOCS_REFS_IN_CANVAS} repo root + manifest self-entry`}
            segments={[
              { id: "refs", value: DOCS_REFS_IN_CANVAS, color: "blue" },
              { id: "root", value: LOCAL_DOCS_COUNT - DOCS_REFS_IN_CANVAS, color: "gray" },
            ]}
          />
          <Text tone="tertiary" size="small">
            SSOT: src/lib/canonical-references.ts → bun run references:generate → ~/.kimi-code/
            after sync
          </Text>
        </Stack>
      </Grid>

      <Card>
        <CardHeader trailing={<Pill size="sm">orthogonal to plugin plan</Pill>}>
          [finishWork].gates (in-repo)
        </CardHeader>
        <CardBody>
          <Row gap={8} wrap>
            <Pill>bun run check:fast</Pill>
            <Pill>kimi-doctor --effect-gates</Pill>
            <Pill>kimi-doctor --automation</Pill>
            <Pill>kimi-heal effect audit</Pill>
          </Row>
        </CardBody>
      </Card>

      <CollapsibleSection title="SSOT pipeline + related paths" defaultOpen={false}>
        <Table
          headers={["Step", "Command / path"]}
          rows={[
            ["Edit manifest SSOT", "src/lib/canonical-references.ts"],
            ["Regenerate JSON", "bun run references:generate"],
            ["Sync runtime", "bun run sync && bun run sync:verify"],
            ["Agent discovery", "kimi-doctor --probe → canonicalReferences"],
            ["Hub doc", "docs/references/namespace.md"],
            [
              "Endpoints pathname gate",
              "schemas/endpoints-strict.schema.toml · bun run dx:table:contract",
            ],
            ["Agent guide", "AGENTS.md § Project docs"],
          ]}
          striped
        />
      </CollapsibleSection>
    </Stack>
  );
}
