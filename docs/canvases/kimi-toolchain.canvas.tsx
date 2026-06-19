import {
  BarChart,
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
  PieChart,
  Row,
  Stack,
  Stat,
  Table,
  Text,
  UsageBar,
  useCanvasAction,
  useHostTheme,
} from "cursor/canvas";

const NODE_W = 172;
const NODE_H = 46;

const NAME_MATRIX = [
  ["Kimi Code", "Moonshot terminal agent (Node SEA)", "~/.kimi-code/bin/kimi", "kimi doctor"],
  ["kimi-toolchain", "Bun-native dev-tools (this repo)", "~/kimi-toolchain/", "kimi-doctor"],
  ["~/.kimi-code/", "Shared runtime home + extensions", "tools/ · lib/ · mcp.json", "bun run sync"],
  ["dx", "Global Bun platform (separate codebase)", "~/.config/dx/", "dx config"],
  ["Kimi Work", "Desktop knowledge agent", "Kimi.app", "Not toolchain scope"],
] as const;

const TOOL_CATEGORIES = [
  { id: "diag", label: "Diagnostics", count: 5 },
  { id: "gov", label: "Governance", count: 4 },
  { id: "heal", label: "Heal / Memory", count: 5 },
  { id: "scaffold", label: "Scaffold", count: 5 },
  { id: "herdr", label: "Herdr", count: 6 },
  { id: "infra", label: "Router / Bridge", count: 2 },
] as const;

const TOOL_INVENTORY = [
  ["Diagnostics", "kimi-doctor, kimi-debug, kimi-orphan-kill, kimi-config, kimi-identity"],
  [
    "Governance / Security",
    "kimi-governance, kimi-guardian, kimi-githooks, kimi-cloudflare-access",
  ],
  [
    "Heal / Memory",
    "kimi-heal, kimi-memory, kimi-snapshot, kimi-decision, kimi-resource-governor (health-listen)",
  ],
  ["Scaffold / Release", "kimi-fix, kimi-new, kimi-context-gen, kimi-cleanup-legacy, kimi-release"],
  ["Herdr", "herdr-doctor, herdr-orchestrator, herdr-project, herdr-pane, herdr-spawn, herdr-latm"],
  ["Infrastructure", "kimi-toolchain (router), unified-shell-bridge (MCP stdio)"],
] as const;

const GATE_LAYERS = [
  ["Fast iterate", "bun run check:fast", "~3s · 150 unit files @ 1500ms", "Local TDD"],
  ["Pre-commit", "format:check + lint + typecheck", "kimi-githooks install", "git commit"],
  [
    "Pre-push",
    "check:fast + guardian + effect-gates + R-Score + sync",
    "Blocks grade D/F",
    "git push",
  ],
  ["Full CI", "bun run check / ci:local", "Unit + smoke + integration + coverage", "Handoff"],
  ["Doctor", "kimi-doctor --quick / --all", "Adapters, plugins, MCP, memory", "Agent-ready"],
] as const;

const SUCCESS_METRICS = [
  [
    "Drift latency",
    "Docs, samples, help examples checkable in one doctor run",
    "kimi-doctor --success-metrics",
  ],
  [
    "Error coverage",
    "≥ 90% managed failures get taxonomy + structured context",
    "error-taxonomy.yml + tool-failures.jsonl",
  ],
  [
    "Integration agility",
    "New cloud provider = contract + getSecret() adapter only",
    "provider-contract.ts",
  ],
] as const;

/** Static snapshot from `bun run config:status --json` (regenerate when gates change). */
const CONFIG_STATUS_SNAPSHOT = [
  ["canonical-references", "Discovery", "pass", 73],
  ["constants-manifest", "Define registry", "pass", 68],
  ["constant-parity", "Cross-repo contract", "pass", 65],
] as const;

const HEALTH_CHANNEL = [
  ["Publisher", "kimi-doctor", "tool:start · tool:progress · tool:done · result at entry/exit"],
  ["Subscriber", "kimi-resource-governor health-listen", "warning + load events from other tools"],
  ["Transport", "~/.kimi-code/var/health-events.jsonl", "Append-only JSONL — same pattern as tool-failures.jsonl"],
  ["Module", "src/lib/health-channel.ts", "Cross-process telemetry; advisory, not critical path"],
] as const;

const AGENT_LOOP = [
  [
    "Before session",
    "kimi-doctor --agent-ready → --quick → kimi-governance score --preflight --quick",
  ],
  ["During iteration", "bun run check:fast · bun test <file> · avoid full suite every edit"],
  ["After tools/docs change", "bun run sync && bun run sync:verify"],
  ["Close loop", "kimi-githooks doctor → conventional commit → finish-work (optional push)"],
] as const;

const HOOK_TAXONOMY = [
  ["Git hooks", ".git/hooks/ via kimi-githooks", "pre-commit · pre-push policy gates"],
  ["Bun postinstall", "src/install-hooks/postinstall.ts", "Idempotent ~/.kimi-code/ layout"],
  [
    "Kimi Code lifecycle",
    "~/.kimi-code/config.toml [[hooks]]",
    "PreToolUse · PostToolUseFailure → failure ledger",
  ],
] as const;

const CANVAS_ROUTING = [
  { id: "kimi-toolchain", page: "Hub", path: "docs/canvases/kimi-toolchain.canvas.tsx", detail: "manifest id unified (this canvas)" },
  { id: "kimi-fix", page: "Scaffold", path: "docs/canvases/kimi-fix.canvas.tsx", detail: "manifest id templates" },
  { id: "configuration-layers", page: "Config SSOT", path: "docs/canvases/configuration-layers.canvas.tsx", detail: "four-layer model" },
  { id: "namespace-boundaries", page: "Name collisions", path: "docs/canvases/namespace-boundaries.canvas.tsx", detail: "doctor trinity" },
  { id: "doc-links-and-see-ladder", page: "Cross-ref ladder", path: "docs/canvases/doc-links-and-see-ladder.canvas.tsx", detail: "code-references" },
  { id: "herdr-dashboard-automation", page: "Finish-work shell", path: "docs/canvases/herdr-dashboard-automation.canvas.tsx", detail: "kimi-doctor" },
  { id: "herdr-dashboard-thumbnails", page: "Orchestrator HTTP", path: "docs/canvases/herdr-dashboard-thumbnails.canvas.tsx", detail: "dashboard-thumbnails" },
  { id: "herdr-unified-plugin-architecture", page: "Herdr plugins", path: "docs/canvases/herdr-unified-plugin-architecture.canvas.tsx", detail: "herdr-plugin-architecture" },
  { id: "kimi-heal-doctor-scaffold", page: "Effect heal + doctor", path: "docs/canvases/kimi-heal-doctor-scaffold.canvas.tsx", detail: "manifest id deep-quality" },
] as const;

const DAG_NODES = [
  { id: "repo", label: "~/kimi-toolchain", sub: "source of truth" },
  { id: "edit", label: "src/bin · src/lib", sub: "edit here" },
  { id: "test", label: "bun run check:fast", sub: "150 unit gates" },
  { id: "sync", label: "bun run sync", sub: "sync-to-desktop.ts" },
  { id: "runtime", label: "~/.kimi-code/", sub: "tools/ · lib/ · manifest" },
  { id: "path", label: "~/.local/bin/kimi-*", sub: "thin wrappers" },
  { id: "cli", label: "kimi-doctor · kimi-*", sub: "PATH commands" },
] as const;

const DAG_EDGES = [
  { from: "repo", to: "edit" },
  { from: "edit", to: "test" },
  { from: "test", to: "sync" },
  { from: "sync", to: "runtime" },
  { from: "runtime", to: "path" },
  { from: "path", to: "cli" },
] as const;

const BIN_COUNT = 27;
const LIB_COUNT = 237;
const UNIT_COUNT = 150;
const INTEGRATION_COUNT = 5;
const SMOKE_COUNT = 6;
const CURSOR_CANVAS_COUNT = 9;

function SyncFlowDag() {
  const theme = useHostTheme();
  const nodeById = Object.fromEntries(DAG_NODES.map((n) => [n.id, n]));
  const layout = computeDAGLayout({
    nodes: DAG_NODES.map((n) => ({ id: n.id })),
    edges: [...DAG_EDGES],
    direction: "vertical",
    nodeWidth: NODE_W,
    nodeHeight: NODE_H,
    rankGap: 44,
    nodeGap: 18,
    padding: 12,
  });

  return (
    <div style={{ overflowX: "auto" }}>
      <svg
        width={layout.width}
        height={layout.height}
        role="img"
        aria-label="Repo to runtime sync flow"
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
          const hub = pos.id === "runtime";
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
        Source: UNIFIED.md · accent node = ~/.kimi-code/ runtime (never hand-edit tools/)
      </Text>
    </div>
  );
}

function CanvasLink({ label, path, dispatch }: { label: string; path: string; dispatch: ReturnType<typeof useCanvasAction> }) {
  const theme = useHostTheme();
  return (
    <Button variant="ghost" onClick={() => dispatch({ type: "openFile", path })} style={{ padding: 0, minHeight: "auto", height: "auto", color: theme.accent.primary, textDecoration: "underline", textUnderlineOffset: 2 }}>
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
          <CanvasLink key={`${c.id}-file`} label={`${c.id}.canvas.tsx`} path={c.path} dispatch={dispatch} />,
          <CanvasLink key={`${c.id}-page`} label={c.page} path={c.path} dispatch={dispatch} />,
          c.detail,
        ])}
        rowTone={["info", "success", "neutral", "warning", "neutral", "info", "neutral", "warning", "info"]}
        striped
      />
      <Text tone="tertiary" size="small">Click Canvas or Page to open · read order: Hub → Config or Namespace → Scaffold → Herdr</Text>
    </Stack>
  );
}

export default function KimiToolchainCanvas() {
  return (
    <Stack gap={20} style={{ padding: 24, maxWidth: 960 }}>
      <Stack gap={8}>
        <H1>kimi-toolchain — project hub</H1>
        <Text tone="secondary">
          Bun-native developer tooling: governance, diagnostics, security, and scaffolding · MIT ·
          Bun ≥ 1.4
        </Text>
        <Row gap={8} wrap>
          <Pill>{BIN_COUNT} CLI bins</Pill>
          <Pill>{LIB_COUNT} lib modules</Pill>
          <Pill>{UNIT_COUNT} unit tests</Pill>
          <Pill tone="info">Runtime: ~/.kimi-code/</Pill>
        </Row>
      </Stack>

      <Grid columns={4} gap={12}>
        <Stat label="CLI tools" value={String(BIN_COUNT)} tone="info" />
        <Stat label="Lib modules" value={String(LIB_COUNT)} />
        <Stat label="Fast unit gate" value={String(UNIT_COUNT)} />
        <Stat label="Runtime deps" value="2" tone="success" />
      </Grid>

      <Callout tone="info" title="Meta-project">
        kimi-toolchain manages other projects. Source lives in ~/kimi-toolchain; live commands
        resolve through ~/.kimi-code/tools/ after sync. Kimi Code agent config is separate — use
        kimi doctor, not kimi-doctor.
      </Callout>

      <Grid columns={2} gap={16}>
        <Stack gap={12}>
          <H2>Name matrix</H2>
          <Table
            headers={["Name", "What", "Path", "Check with"]}
            rows={NAME_MATRIX.map((r) => [...r])}
            rowTone={["info", "neutral", "neutral", "warning", "neutral"]}
            striped
          />
        </Stack>

        <Stack gap={12}>
          <H2>Development sync flow</H2>
          <SyncFlowDag />
        </Stack>
      </Grid>

      <Grid columns={2} gap={16}>
        <Card>
          <CardHeader trailing={<Pill size="sm">{BIN_COUNT} bins</Pill>}>
            Tool inventory by domain
          </CardHeader>
          <CardBody style={{ padding: 0 }}>
            <Table headers={["Domain", "Tools"]} rows={TOOL_INVENTORY.map((r) => [...r])} striped />
          </CardBody>
        </Card>

        <Stack gap={12}>
          <H3>CLI bins by category</H3>
          <BarChart
            categories={TOOL_CATEGORIES.map((c) => c.label)}
            series={[
              { name: "Registered bins", data: TOOL_CATEGORIES.map((c) => c.count), tone: "info" },
            ]}
            height={180}
          />
          <Text tone="tertiary" size="small">
            Source: package.json bin · Y-axis: count (bins) · X-axis: domain · total {BIN_COUNT}{" "}
            entry points
          </Text>
          <UsageBar
            total={BIN_COUNT}
            topLeftLabel="Tool domain mix"
            topRightLabel={`${BIN_COUNT} / ${BIN_COUNT} bins`}
            segments={TOOL_CATEGORIES.map((c) => ({ id: c.id, value: c.count }))}
          />
        </Stack>
      </Grid>

      <Grid columns={2} gap={16}>
        <Stack gap={12}>
          <H3>Test files by tier</H3>
          <PieChart
            data={[
              { label: "Unit (fast gate)", value: UNIT_COUNT },
              { label: "Integration", value: INTEGRATION_COUNT },
              { label: "Smoke", value: SMOKE_COUNT },
            ]}
            size={200}
            donut
          />
          <Text tone="tertiary" size="small">
            Source: src/lib/test-gates.ts · fast gate = {UNIT_COUNT} files @ 1500ms · full suite
            adds smoke + integration
          </Text>
        </Stack>

        <Card>
          <CardHeader trailing={<Pill size="sm">5 layers</Pill>}>Quality gates</CardHeader>
          <CardBody style={{ padding: 0 }}>
            <Table
              headers={["Layer", "Command", "Scope", "Trigger"]}
              rows={GATE_LAYERS.map((r) => [...r])}
              rowTone={["success", "info", "warning", "neutral", "info"]}
              striped
            />
          </CardBody>
        </Card>
      </Grid>

      <Grid columns={2} gap={16}>
        <Card>
          <CardHeader trailing={<Pill size="sm">3 metrics</Pill>}>Success metrics</CardHeader>
          <CardBody style={{ padding: 0 }}>
            <Table
              headers={["Metric", "Contract", "Audit"]}
              rows={SUCCESS_METRICS.map((r) => [...r])}
              rowTone={["info", "success", "neutral"]}
              striped
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader trailing={<Pill size="sm">3 systems</Pill>}>Hook taxonomy</CardHeader>
          <CardBody style={{ padding: 0 }}>
            <Table
              headers={["System", "Location", "Purpose"]}
              rows={HOOK_TAXONOMY.map((r) => [...r])}
              striped
            />
          </CardBody>
        </Card>
      </Grid>

      <Card>
        <CardHeader trailing={<Pill size="sm">agent loop</Pill>}>Agent workflow</CardHeader>
        <CardBody style={{ padding: 0 }}>
          <Table headers={["Phase", "Commands"]} rows={AGENT_LOOP.map((r) => [...r])} striped />
        </CardBody>
      </Card>

      <Card>
        <CardHeader trailing={<Pill size="sm">JSONL</Pill>}>Health channel (cross-tool telemetry)</CardHeader>
        <CardBody style={{ padding: 0 }}>
          <Table
            headers={["Role", "Tool / path", "Behavior"]}
            rows={HEALTH_CHANNEL.map((r) => [...r])}
            rowTone={["info", "success", "neutral", "neutral"]}
            striped
          />
        </CardBody>
        <CardBody>
          <Text tone="tertiary" size="small">
            Added 2026-06-18 · subscribe: kimi-resource-governor health-listen · publish: kimi-doctor
            diagnostic runs
          </Text>
        </CardBody>
      </Card>

      <Card>
        <CardHeader trailing={<Pill size="sm">static snapshot</Pill>}>
          Configuration layers status
        </CardHeader>
        <CardBody style={{ padding: 0 }}>
          <Table
            headers={["Gate", "Layer", "Status", "ms"]}
            rows={CONFIG_STATUS_SNAPSHOT.map((r) => [r[0], r[1], r[2], String(r[3])])}
            rowTone={["info", "neutral", "success", "neutral"]}
            striped
          />
        </CardBody>
        <CardBody>
          <Text tone="tertiary" size="small">
            Snapshot: bun run config:status --json · live: bun run config:status · companion canvas:
            docs/canvases/configuration-layers.canvas.tsx
          </Text>
        </CardBody>
      </Card>

      <CollapsibleSection title={`Related canvases (${CURSOR_CANVAS_COUNT} manifest-backed)`} defaultOpen>
        <RelatedCanvasesTable />
      </CollapsibleSection>

      <Stack gap={4}>
        <H3>Key docs</H3>
        <Row gap={8} wrap>
          <Pill>AGENTS.md</Pill>
          <Pill>UNIFIED.md</Pill>
          <Pill>CODE_REFERENCES.md</Pill>
          <Pill>docs/references/namespace.md</Pill>
          <Pill>docs/references/configuration-layers.md</Pill>
          <Pill>docs/references/bun-runtime-scaffold.md</Pill>
          <Pill>docs/references/template-matrix.md</Pill>
          <Pill>docs/references/herdr-plugin-architecture.md</Pill>
        </Row>
        <Text tone="tertiary" size="small">
          Canonical clone path: ~/kimi-toolchain · verify with kimi-toolchain workspace verify ·
          unify checklist: bun run unify
        </Text>
      </Stack>
    </Stack>
  );
}
