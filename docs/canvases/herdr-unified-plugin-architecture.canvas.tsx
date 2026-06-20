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
  TodoListCard,
  UsageBar,
  useCanvasAction,
  useHostTheme,
} from "cursor/canvas";

const PLAN_VERSION = "0.5.0-unified";
const MIN_HERDR = "0.7.0";

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
    detail: "manifest id herdr-plugin-architecture (this canvas)",
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
  "success",
  "neutral",
  "neutral",
  "neutral",
  "neutral",
  "neutral",
] as const;
const ARCHITECTURE_MATRIX = [
  ["Remote Agent Lifecycle", "herdr-orchestrator", "[[actions]] x4", "HERDR_PLUGIN_STATE_DIR", "—"],
  ["Handoff Audit Trail", "herdr-orchestrator", "[[events]] x2", "HERDR_PLUGIN_STATE_DIR", "—"],
  ["Fleet Dashboard", "herdr-orchestrator", "[[panes]] x1", "HERDR_PLUGIN_STATE_DIR", "—"],
  ["GitHub Link Previews", "herdr-orchestrator", "[[link_handlers]] x3", "—", "—"],
  [
    "Doctor Diagnostics",
    "herdr-doctor",
    "[[panes]] x1, [[actions]] x1",
    "HERDR_PLUGIN_STATE_DIR",
    "—",
  ],
  ["Webhook Notifications", "herdr-notify", "[[events]] x3", "—", "HERDR_PLUGIN_CONFIG_DIR"],
  ["Keybindings", "Core Herdr", "[[keys.command]] x6", "—", "~/.config/herdr/config.toml"],
  ["SSH Bridge", "Core Herdr", "[remote]", "—", "~/.ssh/config + dx.config.toml"],
] as const;

const PLUGIN_VERSIONS = [
  ["herdr-orchestrator", "0.5.0", "8 actions · 2 events · 1 pane · 3 link handlers"],
  ["herdr-doctor", "0.3.0", "1 pane · 1 action · manifest validate"],
  ["herdr-notify", "0.2.0", "3 events · Slack/Discord webhooks"],
] as const;

const KEYBINDINGS = [
  ["prefix+a", "herdr-orchestrator.agent-start", "Start remote agent"],
  ["prefix+shift+a", "herdr-orchestrator.agent-stop", "Stop remote agent"],
  ["prefix+l", "herdr-orchestrator.agent-attach", "Attach remote agent logs"],
  ["prefix+f", "herdr-orchestrator.agent-list", "List remote fleet"],
  ["prefix+t", "herdr-orchestrator.audit-tail", "Tail handoff audit"],
  ["prefix+d", "herdr-doctor.status", "Doctor status"],
] as const;

const STORAGE = [
  [
    "herdr-orchestrator",
    "handoff-history.jsonl",
    "HERDR_PLUGIN_STATE_DIR",
    "Append-only · 50MB rotate · gzip archive",
  ],
  [
    "herdr-orchestrator",
    "manifest-cache.json",
    "HERDR_PLUGIN_STATE_DIR",
    "30s TTL · local manifest cache",
  ],
  ["herdr-notify", "notify.json", "HERDR_PLUGIN_CONFIG_DIR", "User webhooks + throttle"],
  ["Core Herdr", "config.toml", "~/.config/herdr/", "Keybindings + remote profile"],
  ["Core Herdr", "config.toml", "~/.config/dx/", "DX canonical copy"],
] as const;

const CLI_SURFACE = [
  [
    "Start remote agent",
    "herdr plugin action invoke herdr-orchestrator.agent-start",
    "prefix+a",
    "agent-start",
  ],
  [
    "Stop remote agent",
    "herdr plugin action invoke herdr-orchestrator.agent-stop",
    "prefix+shift+a",
    "agent-stop",
  ],
  [
    "Attach agent logs",
    "herdr plugin action invoke herdr-orchestrator.agent-attach",
    "prefix+l",
    "agent-attach",
  ],
  [
    "List remote fleet",
    "herdr plugin action invoke herdr-orchestrator.agent-list",
    "prefix+f",
    "agent-list",
  ],
  [
    "Tail handoff audit",
    "herdr plugin action invoke herdr-orchestrator.audit-tail",
    "prefix+t",
    "audit-tail",
  ],
  ["Doctor status", "herdr plugin action invoke herdr-doctor.status", "prefix+d", "status"],
  [
    "Open dashboard",
    "herdr plugin pane open --plugin herdr-orchestrator --entrypoint dashboard",
    "—",
    "dashboard",
  ],
  ["Preview GitHub PR", "Control+click PR URL", "—", "pr-preview"],
  ["Preview GitHub Issue", "Control+click Issue URL", "—", "issue-preview"],
  ["Preview GitHub Commit", "Control+click Commit URL", "—", "commit-preview"],
] as const;

const MARKETPLACE = [
  [
    "herdr-orchestrator",
    "brendadeeznuts1111/herdr-orchestrator",
    "herdr plugin install brendadeeznuts1111/herdr-orchestrator",
  ],
  [
    "herdr-doctor",
    "brendadeeznuts1111/herdr-doctor",
    "herdr plugin install brendadeeznuts1111/herdr-doctor",
  ],
  [
    "herdr-notify",
    "brendadeeznuts1111/herdr-notify",
    "herdr plugin install brendadeeznuts1111/herdr-notify",
  ],
] as const;

const CROSS_REF = [
  ["handoff-audit event", "audit.ts", "logEvent() on agent.handoff"],
  ["spawn-audit event", "audit.ts", "logEvent() on agent.spawn"],
  ["audit-tail action", "handoff-history.jsonl", "Reads STATE_DIR audit log"],
  ["agent-start/stop/attach/list", "remote/agent.ts", "SSH exec to remote herdr CLI"],
  ["pr/issue/commit-preview", "GitHub API", "Control+click link_handlers route"],
  ["doctor/status", "manifest/validate.ts", "fetchManifests + validateAgentLocal"],
  ["notify events", "notify.json", "Webhooks from CONFIG_DIR · throttle filter"],
  ["Keybindings", "All actions", "prefix+* maps to plugin_action IDs"],
] as const;

const ACTIVATION_STEPS = [
  ["0", "Prerequisites", "Herdr 0.7.0+ · Bun · SSH host alias (e.g. workbox)"],
  ["1", "Scaffold", "mkdir ~/dev/herdr-plugins/{orchestrator,doctor,notify}/src/..."],
  ["2", "Manifests", "Copy herdr.plugin.toml x3 from plan Section 3"],
  ["3", "Source", "Copy src/**/*.ts from plan Section 5"],
  ["4", "Link", "herdr plugin link ~/dev/herdr-plugins/* x3"],
  ["5", "Notify config", "Write notify.json to herdr plugin config-dir"],
  ["6", "Keybindings", "Append [[keys.command]] to ~/.config/herdr/config.toml"],
  ["7", "SSH", "Uncomment Host workbox in ~/.ssh/config"],
  ["8", "Verify", "plugin action invoke agent-list · doctor.status · plugin log list"],
  ["9", "Reload", "herdr plugin reload {orchestrator,doctor,notify}"],
] as const;

const GAP_ITEMS = [
  {
    id: "gap-1",
    content: "Plugin directory scaffold (~/dev/herdr-plugins/)",
    status: "pending" as const,
  },
  {
    id: "gap-2",
    content: "Manifest files written (herdr.plugin.toml x3)",
    status: "pending" as const,
  },
  { id: "gap-3", content: "Core .ts implementations (src/**/*.ts)", status: "pending" as const },
  { id: "gap-4", content: "herdr plugin link executed", status: "pending" as const },
  { id: "gap-5", content: "notify.json written to config dir", status: "pending" as const },
  { id: "gap-6", content: "Keybindings appended to config.toml", status: "pending" as const },
  { id: "gap-7", content: "SSH host uncommented + filled", status: "pending" as const },
  {
    id: "gap-8",
    content: "herdr-plugin GitHub topic added (x3 repos)",
    status: "pending" as const,
  },
  { id: "gap-9", content: "Dashboard pane implementation (stub)", status: "in_progress" as const },
  { id: "gap-10", content: "Doctor pane implementation (stub)", status: "in_progress" as const },
  { id: "gap-11", content: "Live handoff test (--handoff remote)", status: "in_progress" as const },
  { id: "gap-12", content: "Audit rotation (50MB + gzip)", status: "completed" as const },
  { id: "gap-13", content: "Error shape alignment (no throws)", status: "completed" as const },
  { id: "gap-14", content: "Env-native paths (no hardcoding)", status: "completed" as const },
  { id: "gap-15", content: "Context JSON + argv dual read", status: "completed" as const },
];

const DESIGN_RULES = [
  "No premature interfaces — flat types only",
  "No pass-through managers — sshExec is the only remote abstraction",
  "No config wrappers — notify.json and config.toml read raw via Bun.file",
  "No try/catch chasm — logEvent returns {ok, error} shapes",
  "Bun-native — Bun.spawn, Bun.file, Bun.CryptoHasher throughout",
  "Plugin link over install — local dev uses herdr plugin link",
] as const;

const DAG_NODES = [
  { id: "core", label: "Core Herdr", sub: "plugin host · keys · remote" },
  { id: "events", label: "Agent events", sub: "handoff · spawn · stop" },
  { id: "orchestrator", label: "herdr-orchestrator", sub: "actions · events · panes" },
  { id: "doctor", label: "herdr-doctor", sub: "diagnostics pane" },
  { id: "notify", label: "herdr-notify", sub: "webhook events" },
  { id: "state", label: "STATE_DIR", sub: "audit.jsonl · manifest-cache" },
  { id: "config", label: "CONFIG_DIR", sub: "notify.json" },
  { id: "ssh", label: "SSH bridge", sub: "remote agent.ts" },
  { id: "github", label: "GitHub API", sub: "link_handlers previews" },
];

const DAG_EDGES = [
  { from: "core", to: "orchestrator" },
  { from: "core", to: "doctor" },
  { from: "core", to: "notify" },
  { from: "events", to: "orchestrator" },
  { from: "events", to: "notify" },
  { from: "orchestrator", to: "state" },
  { from: "orchestrator", to: "ssh" },
  { from: "orchestrator", to: "github" },
  { from: "notify", to: "config" },
  { from: "doctor", to: "state" },
];

function PluginArchitectureDiagram() {
  const theme = useHostTheme();
  const layout = computeDAGLayout({
    nodes: DAG_NODES.map((n) => ({ id: n.id })),
    edges: DAG_EDGES,
    direction: "vertical",
    nodeWidth: 210,
    nodeHeight: 52,
    rankGap: 52,
    nodeGap: 36,
    padding: 16,
  });
  const nodeById = Object.fromEntries(DAG_NODES.map((n) => [n.id, n]));

  return (
    <div style={{ overflowX: "auto" }}>
      <svg
        width={layout.width}
        height={layout.height}
        role="img"
        aria-label="Unified Herdr plugin architecture: three linked plugins, state and config dirs, SSH and GitHub integrations"
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
              markerEnd="url(#plugin-arrow)"
            />
          );
        })}
        <defs>
          <marker
            id="plugin-arrow"
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
          const accent = pos.id === "orchestrator" || pos.id === "doctor" || pos.id === "notify";
          return (
            <g key={pos.id}>
              <rect
                x={pos.x}
                y={pos.y}
                width={210}
                height={52}
                rx={6}
                fill={accent ? theme.fill.secondary : theme.fill.tertiary}
                stroke={accent ? theme.accent.primary : theme.stroke.primary}
                strokeWidth={accent ? 1.5 : 1}
              />
              <text
                x={pos.x + 105}
                y={pos.y + 22}
                textAnchor="middle"
                fill={theme.text.primary}
                fontSize={12}
                fontWeight={600}
              >
                {node.label}
              </text>
              <text
                x={pos.x + 105}
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
        Source: herdr-unified-plan-v0.5.0.md Section 1 · state in HERDR_PLUGIN_STATE_DIR · notify
        config in HERDR_PLUGIN_CONFIG_DIR
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
        Click Canvas or Page to open · Herdr plugin architecture plan
      </Text>
    </Stack>
  );
}

export default function HerdrUnifiedPluginArchitecturePlan() {
  const theme = useHostTheme();

  return (
    <Stack gap={24} style={{ padding: 24, maxWidth: 980 }}>
      <Stack gap={8}>
        <Row gap={8} align="center" wrap>
          <H1>Unified Herdr Plugin Architecture</H1>
          <Pill tone="info">v{PLAN_VERSION}</Pill>
        </Row>
        <Text tone="secondary">
          Three linked plugins — herdr-orchestrator, herdr-doctor, herdr-notify — for remote agent
          lifecycle, handoff audit, diagnostics, and webhook alerts. Local dev via{" "}
          <Text weight="semibold">herdr plugin link</Text>; marketplace via{" "}
          <Text weight="semibold">herdr-plugin</Text> GitHub topic.
        </Text>
      </Stack>

      <Grid columns={4} gap={12}>
        <Stat value="3" label="linked plugins" tone="info" />
        <Stat value={MIN_HERDR} label="min herdr version" />
        <Stat value="6" label="keybindings" />
        <Stat value="3" label="link handlers" />
      </Grid>

      <Callout tone="info" title="TL;DR">
        Remote lifecycle + audit in orchestrator (orange lane). Doctor diagnostics (teal). Webhook
        notify (purple). All mutable plugin state under HERDR_PLUGIN_STATE_DIR; notify webhooks
        under HERDR_PLUGIN_CONFIG_DIR. prefix+a/l/f/t/d bind core actions; Control+click intercepts
        GitHub URLs.
      </Callout>

      <Stack gap={12}>
        <H2>Architecture matrix</H2>
        <Table
          headers={["Capability", "Plugin", "Manifest", "State", "Config"]}
          rows={ARCHITECTURE_MATRIX.map((row) => [...row])}
          rowTone={["info", "info", "info", "info", undefined, "success", undefined, undefined]}
          striped
        />
        <Text tone="tertiary" size="small">
          Source: herdr-unified-plan-v0.5.0.md Section 1 · generated 2026-06-17
        </Text>
      </Stack>

      <Grid columns={2} gap={20}>
        <Stack gap={12}>
          <H2>Plugin topology</H2>
          <PluginArchitectureDiagram />
        </Stack>

        <Stack gap={12}>
          <H2>Plugin versions</H2>
          {PLUGIN_VERSIONS.map(([id, ver, detail]) => (
            <div key={id}>
              <Card>
                <CardHeader trailing={<Pill tone="neutral">v{ver}</Pill>}>{id}</CardHeader>
                <CardBody>
                  <Text size="small" tone="secondary">
                    {detail}
                  </Text>
                </CardBody>
              </Card>
            </div>
          ))}

          <H3>Scaffold root</H3>
          <Text
            size="small"
            style={{ fontFamily: "monospace", color: theme.text.secondary, lineHeight: 1.5 }}
          >
            ~/dev/herdr-plugins/
            <br />
            ├── herdr-orchestrator/src/actions|events|handoff|remote|manifest|panes
            <br />
            ├── herdr-doctor/src/actions|manifest|panes
            <br />
            └── herdr-notify/src/events
          </Text>
        </Stack>
      </Grid>

      <Stack gap={12}>
        <H2>Gap closure tracker</H2>
        <UsageBar
          total={15}
          topLeftLabel="4 of 15 closed in spec"
          topRightLabel="8 open · 3 in progress"
          segments={[
            { id: "closed", value: 4, color: "green" },
            { id: "in_progress", value: 3, color: "yellow" },
            { id: "open", value: 8, color: "orange" },
          ]}
        />
        <TodoListCard todos={GAP_ITEMS} defaultExpanded />
        <Text tone="tertiary" size="small">
          Source: herdr-unified-plan-v0.5.0.md Section 11
        </Text>
      </Stack>

      <Grid columns={2} gap={20}>
        <Stack gap={12}>
          <H2>Keybindings</H2>
          <Table
            headers={["Key", "Command", "Description"]}
            rows={KEYBINDINGS.map((row) => [...row])}
            rowTone={["success", undefined, undefined, undefined, undefined, "info"]}
            striped
          />
          <Text tone="tertiary" size="small">
            Append to ~/.config/herdr/config.toml · type = plugin_action
          </Text>
        </Stack>

        <Stack gap={12}>
          <H2>Storage and state</H2>
          <Table
            headers={["Owner", "File", "Directory", "Lifecycle"]}
            rows={STORAGE.map((row) => [...row])}
            striped
          />
          <Callout tone="warning" title="No Herdr-managed storage API">
            Plugins own files directly via Bun.file and node:fs — no shared storage abstraction.
          </Callout>
        </Stack>
      </Grid>

      <Stack gap={12}>
        <H2>CLI surface and keybinding map</H2>
        <Table
          headers={["Intent", "Herdr command", "Key", "Action ID"]}
          rows={CLI_SURFACE.map((row) => [...row])}
          rowTone={[
            "success",
            undefined,
            undefined,
            undefined,
            undefined,
            "info",
            undefined,
            undefined,
            undefined,
            undefined,
          ]}
          striped
        />
      </Stack>

      <CollapsibleSection title="Activation runbook" count={10} defaultOpen>
        <Table
          headers={["Step", "Phase", "Action"]}
          rows={ACTIVATION_STEPS.map((row) => [...row])}
          rowTone={[
            "info",
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            "success",
            undefined,
          ]}
          striped
        />
      </CollapsibleSection>

      <CollapsibleSection title="Cross-reference index" count={8}>
        <Table
          headers={["From", "To", "Relationship"]}
          rows={CROSS_REF.map((row) => [...row])}
          striped
        />
      </CollapsibleSection>

      <Stack gap={12}>
        <H2>Marketplace and distribution</H2>
        <Table
          headers={["Plugin", "GitHub repo", "Future install"]}
          rows={MARKETPLACE.map((row) => [...row])}
          rowTone={["info", "info", "info"]}
          striped
        />
        <Text tone="tertiary" size="small">
          Action now: add herdr-plugin topic to each repo via GitHub UI
        </Text>
      </Stack>

      <Card>
        <CardHeader trailing={<Pill tone="success">design rules</Pill>}>
          Enforced constraints
        </CardHeader>
        <CardBody>
          <Stack gap={6}>
            {DESIGN_RULES.map((rule) => (
              <div key={rule}>
                <Text size="small">{rule}</Text>
              </div>
            ))}
          </Stack>
        </CardBody>
      </Card>

      <CollapsibleSection
        title={`Related canvases (${CANVAS_ROUTING_COUNT} manifest-backed)`}
        defaultOpen={false}
      >
        <RelatedCanvasesTable />
      </CollapsibleSection>

      <Text tone="tertiary" size="small">
        Plan source: ~/Downloads/herdr-unified-plan-v0.5.0.md · replaces scattered specs (3:1
        deletion ratio)
      </Text>
    </Stack>
  );
}
