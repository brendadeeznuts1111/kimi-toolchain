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

const NODE_W = 176;
const NODE_H = 48;

const FOUR_LAYERS = [
  ["Discovery", "canonical-references.json", "src/lib/canonical-references.ts", "Yes", "Yes"],
  ["Define Registry", "constants-manifest.json", "bunfig.toml [define] + build-constants.d.ts", "Yes", "No"],
  ["Cross-Repo Contract", "constants-parity.toml", "Hand-edited TOML", "No", "No"],
  ["App Scaffold", "templates/scaffold/bunfig.toml", "Template (kimi-fix copy)", "No", "N/A"],
] as const;

const ANTI_CONFUSION = [
  [
    "repos ≠ parity list ≠ local dirs",
    "canonical-references.json → repos has exactly 3 upstream GitHub pointers — not accounting-telegram or local trees",
  ],
  [
    "Parity ≠ discovery",
    "accounting-telegram is in constants-parity.toml but intentionally omitted from canonical-references → repos",
  ],
  [
    "Edit bunfig.toml, not manifest",
    "constants-manifest.json is generated via build-constants-registry.ts — manual edits are overwritten",
  ],
  [
    "Scaffold has no [define]",
    "templates/scaffold/bunfig.toml is install/test policy only — KIMI_* defines live in root bunfig.toml",
  ],
  [
    "App scaffold ≠ bun create",
    "kimi-fix is add-only; bun create local templates wipe the destination — see kimi-fix canvas",
  ],
] as const;

const AGENT_DECISIONS = [
  ["Find external stack links or indexed local docs", "canonical-references.json → ecosystem / localDocs"],
  ["Find GitHub URL for a major upstream", "canonical-references.json → repos (3 entries)"],
  ["Read or change a KIMI_* value", "Root bunfig.toml [define] + types/build-constants.d.ts"],
  ["Discover defaults, domains, define inventory", "constants-manifest.json"],
  ["Verify two repos share tunable parameters", "constants-parity.toml"],
  ["Bootstrap new app install/test policy", "templates/scaffold/bunfig.toml (via kimi-fix)"],
  ["Map bun create / runtime flags to scaffold", "docs/references/bun-runtime-scaffold.md · TEMPLATES.md"],
] as const;

const ENFORCEMENT_GATES = [
  ["All core gates (one shot)", "bun run config:status", "config:status"],
  ["Canonical refs fresh", "bun run references:generate --check", "canonical-references"],
  ["Manifest fresh", "bun run manifest:generate --check", "constants-manifest"],
  ["Parity aligned", "bun run lint:constant-parity", "constant-parity"],
  ["Runtime cache valid", "bun run sync; probe:canonical-references:*", "handoff probes"],
  ["Canvas pointers valid", "bun run scripts/lint-cursor-canvas.ts", "cursor-canvas"],
] as const;

const RELATED_PATHS = [
  ["Build-time constants naming", "CODE_REFERENCES.md § Build-time constants"],
  ["Ecosystem manifest + handoff probes", "docs/references/namespace.md"],
  ["Ecosystem link SSOT", "src/lib/canonical-references.ts → canonical-references.json"],
  ["Scaffold + bun create flags", "docs/references/bun-runtime-scaffold.md · docs/canvases/kimi-fix.canvas.tsx"],
  ["Define registry generator", "src/lib/build-constants-registry.ts → constants-manifest.json"],
  ["Cross-repo parity config", "constants-parity.toml"],
  ["Bun runtime scaffold flags and install config", "docs/references/bun-runtime-scaffold.md"],
] as const;

const CANVAS_ROUTING = [
  ["kimi-toolchain", "Project hub", "Start here for tools and gates"],
  ["configuration-layers", "Config SSOT", "This canvas — four-layer model"],
  ["kimi-fix", "Scaffold", "bun create · profiles · kimi-fix doctor"],
  ["namespace-boundaries", "Name collisions", "Doctor trinity · prefix+*"],
] as const;

const CANONICAL_REPOS = ["kimi-toolchain", "kimi-code-upstream", "effect-upstream"] as const;

const DAG_NODES = [
  { id: "agent", label: "Agent / Developer", sub: "task routing" },
  { id: "task", label: "What is the task?", sub: "pick the layer" },
  { id: "canonical", label: "canonical-references.json", sub: "ecosystem · localDocs · repos" },
  { id: "bunfig", label: "bunfig.toml [define]", sub: "+ build-constants.d.ts" },
  { id: "manifest", label: "constants-manifest.json", sub: "generated inventory" },
  { id: "parity", label: "constants-parity.toml", sub: "hand-edited contract" },
  { id: "scaffold", label: "scaffold/bunfig.toml", sub: "kimi-fix template" },
  { id: "runtime", label: "~/.kimi-code/", sub: "synced agent cache" },
] as const;

const DAG_EDGES = [
  { from: "agent", to: "task" },
  { from: "task", to: "canonical" },
  { from: "task", to: "bunfig" },
  { from: "task", to: "manifest" },
  { from: "task", to: "parity" },
  { from: "task", to: "scaffold" },
  { from: "bunfig", to: "manifest" },
  { from: "canonical", to: "runtime" },
] as const;

const LAYER_ROW_TONE = ["info", "neutral", "warning", "success"] as const;

function TaskRoutingDag() {
  const theme = useHostTheme();
  const nodeById = Object.fromEntries(DAG_NODES.map((n) => [n.id, n]));
  const layout = computeDAGLayout({
    nodes: DAG_NODES.map((n) => ({ id: n.id })),
    edges: [...DAG_EDGES],
    direction: "vertical",
    nodeWidth: NODE_W,
    nodeHeight: NODE_H,
    rankGap: 44,
    nodeGap: 16,
    padding: 12,
  });

  const hubIds = new Set(["task", "bunfig"]);
  const syncIds = new Set(["runtime"]);
  const generateEdgeKeys = new Set(["bunfig→manifest"]);

  return (
    <div style={{ overflowX: "auto" }}>
      <svg
        width={layout.width}
        height={layout.height}
        role="img"
        aria-label="Configuration layer task routing — discovery, define registry, parity, scaffold"
      >
        {layout.edges.map((edge, i) => {
          const key = `${edge.from}→${edge.to}`;
          const dashed = edge.isBackEdge || generateEdgeKeys.has(key);
          const midY = (edge.sourceY + edge.targetY) / 2;
          const d = `M ${edge.sourceX} ${edge.sourceY} C ${edge.sourceX} ${midY}, ${edge.targetX} ${midY}, ${edge.targetX} ${edge.targetY}`;
          return (
            <path
              key={i}
              d={d}
              fill="none"
              stroke={dashed ? theme.stroke.tertiary : theme.stroke.secondary}
              strokeWidth={dashed ? 1 : 1.5}
              strokeDasharray={dashed ? "4 3" : undefined}
            />
          );
        })}
        {layout.nodes.map((pos) => {
          const node = nodeById[pos.id];
          if (!node) return null;
          const hub = hubIds.has(pos.id);
          const sync = syncIds.has(pos.id);
          return (
            <g key={pos.id}>
              <rect
                x={pos.x}
                y={pos.y}
                width={NODE_W}
                height={NODE_H}
                rx={6}
                fill={sync ? theme.fill.secondary : hub ? theme.fill.secondary : theme.fill.tertiary}
                stroke={hub ? theme.accent.primary : sync ? theme.stroke.primary : theme.stroke.primary}
                strokeWidth={hub ? 1.5 : 1}
              />
              <text
                x={pos.x + NODE_W / 2}
                y={pos.y + 20}
                textAnchor="middle"
                fill={theme.text.primary}
                fontSize={10}
                fontWeight={600}
              >
                {node.label}
              </text>
              <text
                x={pos.x + NODE_W / 2}
                y={pos.y + 36}
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
        Source: docs/references/configuration-layers.md · dashed edge = bunfig generates manifest; canonical syncs to
        ~/.kimi-code/
      </Text>
    </div>
  );
}

export default function ConfigurationLayersCanvas() {
  return (
    <Stack gap={20} style={{ padding: 24, maxWidth: 960 }}>
      <Stack gap={8}>
        <H1>Configuration layers — discovery, build, parity, scaffold</H1>
        <Text tone="secondary">
          Source: docs/references/configuration-layers.md · manifest id configuration-layers · four distinct layers, not
          interchangeable
        </Text>
        <Row gap={8} wrap>
          <Pill>4 layers</Pill>
          <Pill>3 canonical repos</Pill>
          <Pill>5 anti-confusion rules</Pill>
          <Pill>6 enforcement gates</Pill>
        </Row>
      </Stack>

      <Callout tone="warning" title="Gold rule for agents">
        Do not treat these files as aliases. Always consult the correct layer for the task — repos in
        canonical-references.json is not the parity repo list, and constants-manifest.json is never the SSOT for
        KIMI_* values.
      </Callout>

      <Grid columns={4} gap={12}>
        <Stat label="Layers" value="4" tone="info" />
        <Stat label="Synced to runtime" value="1" />
        <Stat label="Generated artifacts" value="2" />
        <Stat label="Hand-edited contracts" value="1" tone="warning" />
      </Grid>

      <H2>Four-layer model</H2>
      <Table
        headers={["Layer", "File", "Edit SSOT", "Generated?", "Synced?"]}
        rows={FOUR_LAYERS.map((r) => [...r])}
        rowTone={[...LAYER_ROW_TONE]}
        striped
      />

      <Grid columns={2} gap={16}>
        <Stack gap={12}>
          <H2>Agent decision table</H2>
          <Text tone="secondary" size="small">
            Route by intent — each row maps one task to exactly one layer artifact.
          </Text>
          <Table
            headers={["If you are trying to…", "Look at…"]}
            rows={AGENT_DECISIONS.map((r) => [...r])}
            rowTone={["info", "info", "neutral", "neutral", "warning", "success", "neutral"]}
            striped
          />
        </Stack>

        <Stack gap={12}>
          <H2>Task routing flow</H2>
          <Text tone="secondary" size="small">
            Discovery vs build vs parity vs scaffold — converges on the correct SSOT per task type.
          </Text>
          <TaskRoutingDag />
        </Stack>
      </Grid>

      <Card>
        <CardHeader trailing={<Pill size="sm">read first</Pill>}>Anti-confusion rules</CardHeader>
        <CardBody style={{ padding: 0 }}>
          <Table
            headers={["Rule", "Detail"]}
            rows={ANTI_CONFUSION.map((r) => [...r])}
            rowTone={["danger", "warning", "danger", "neutral", "warning"]}
            striped
          />
        </CardBody>
      </Card>

      <Grid columns={2} gap={16}>
        <Stack gap={12}>
          <H3>canonical-references.json → repos</H3>
          <Text tone="secondary" size="small">
            Exactly three major upstream GitHub pointers — not local working trees or parity-only repos.
          </Text>
          <Row gap={8} wrap>
            <Pill>{CANONICAL_REPOS[0]}</Pill>
            <Pill>{CANONICAL_REPOS[1]}</Pill>
            <Pill>{CANONICAL_REPOS[2]}</Pill>
          </Row>
          <Text tone="tertiary" size="small">
            accounting-telegram appears in constants-parity.toml only — intentionally omitted from repos.
          </Text>
        </Stack>

        <Stack gap={12}>
          <H3>Define registry pipeline</H3>
          <Table
            headers={["Step", "Artifact / command"]}
            rows={[
              ["Edit values", "bunfig.toml [define] + types/build-constants.d.ts"],
              ["Regenerate inventory", "bun run manifest:generate"],
              ["Check freshness", "bun run manifest:generate --check"],
              ["Read-only discovery", "constants-manifest.json"],
            ]}
            striped
          />
          <Text tone="tertiary" size="small">
            Generator: src/lib/build-constants-registry.ts · repo-only — not synced to ~/.kimi-code/
          </Text>
        </Stack>
      </Grid>

      <CollapsibleSection title="Related canvases" count={4} defaultOpen={false}>
        <Table
          headers={["Canvas", "Topic", "Open when"]}
          rows={CANVAS_ROUTING.map((r) => [...r])}
          rowTone={["info", "info", "success", "warning"]}
          striped
        />
      </CollapsibleSection>

      <CollapsibleSection title="Lint / doctor enforcement wiring" count={6} defaultOpen>
        <Table
          headers={["Gate", "Command", "Lint label"]}
          rows={ENFORCEMENT_GATES.map((r) => [...r])}
          rowTone={["success", "info", "neutral", "warning", "neutral", "neutral"]}
          striped
        />
        <Text tone="tertiary" size="small">
          Runtime doc path: ~/.kimi-code/docs/references/configuration-layers.md after bun run sync
        </Text>
      </CollapsibleSection>

      <CollapsibleSection title="Related docs and SSOT paths" count={7} defaultOpen={false}>
        <Table headers={["Topic", "Path"]} rows={RELATED_PATHS.map((r) => [...r])} striped />
      </CollapsibleSection>
    </Stack>
  );
}
