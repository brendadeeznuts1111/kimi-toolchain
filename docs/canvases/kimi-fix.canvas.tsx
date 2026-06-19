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
  Link,
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

const BUN_CREATE_DOCS = "https://bun.com/docs/runtime/templating/create";
const BUN_RUNTIME_DOCS = "https://bun.com/docs/runtime";

const NODE_W = 160;
const NODE_H = 44;

const CLI_COMMANDS = [
  ["kimi-fix <path>", "Scaffold missing files (default profile: app)", "—profile app|toolchain · —dry-run"],
  ["kimi-fix fix <path>", "Explicit fix subcommand", "Same flags as above"],
  ["kimi-fix doctor [path]", "Audit scaffold completeness", "Exit 1 on warn/error"],
] as const;

const ENTRY_POINTS = [
  ["kimi-fix .", "Repair existing project", "Adds only missing files — never overwrites"],
  ["kimi-new <name>", "Greenfield scaffold", "mkdir → bun init -m -y → kimi-fix (bridge pattern)"],
  ["bun create kimi-toolchain", "Local template", "postinstall: global toolchain → kimi-fix"],
] as const;

const BUN_CREATE_FLAGS = [
  ["--force", "Overwrite existing files (remote/GitHub only by default)"],
  ["--no-install", "Skip node_modules install and bun-create hook tasks"],
  ["--no-git", "Skip git init + initial commit"],
  ["--open", "Start and open in browser after finish (React component templates)"],
] as const;

const BUN_CREATE_HOOKS = [
  ["preinstall", "Runs before bun install", "string or string[]"],
  ["postinstall", "Runs after bun install", "string or string[] — kimi-toolchain uses this"],
  ["start", "Optional post-scaffold script", "e.g. dev server for component templates"],
] as const;

const BUN_CREATE_LOCAL_FLOW = [
  ["1", "Resolve template", "~/.bun-create/kimi-toolchain or ./.bun-create/ (BUN_CREATE_DIR override)"],
  ["2", "Delete destination", "Local templates recursively wipe existing dest dir"],
  ["3", "Copy files", "Fast copy; skips node_modules if present in template"],
  ["4", "Rewrite package.json", "Set name to dest basename; strip bun-create section"],
  ["5", "preinstall hooks", "None in kimi-toolchain template"],
  ["6", "bun install", "Skipped when package.json has no dependencies"],
  ["7", "postinstall hooks", "bun install -g …kimi-toolchain → kimi-fix ."],
  ["8", "git init", "git add -A && initial commit (unless --no-git)"],
] as const;

const SCAFFOLD_CONTRAST = [
  ["Overwrite policy", "kimi-fix: skip existing files", "bun create local: delete dest first"],
  ["git init", "kimi-fix: only if no .git", "bun create: always (unless --no-git)"],
  ["package.json", "kimi-fix: inject missing scripts only", "bun create: rewrite name, strip hooks"],
  ["Entry artifact", "templates/scaffold/ via kimi-fix", "templates/bun-create/kimi-toolchain/ skeleton"],
] as const;

const DEBUG_WORKFLOWS = [
  ["Inspect skeleton only", "bun create kimi-toolchain my-app --no-install", "Skips postinstall; run kimi-fix manually"],
  ["Low memory create", "bun --smol create kimi-toolchain my-app", "Bun flags before create"],
  ["Re-scaffold in place", "kimi-fix .  or  bun run fix", "Add-only; does not re-run bun-create postinstall"],
  ["Preview then apply", "kimi-fix . --dry-run  then  kimi-fix .", "No --verbose flag on kimi-fix"],
] as const;

const BUN_INSTALL_OPTS = [
  ["linker = \"isolated\"", "Per-package isolation — required for globalStore"],
  ["globalStore = true", "Experimental (Bun ≥1.3.14) · ~7× faster warm installs · auto-fallback"],
  ["frozenLockfile = true", "Hardened install policy via bun-install-config.ts"],
  ["minimumReleaseAge", "259200s supply-chain gate — excludes @types/* and typescript"],
] as const;

const BUN_RUNTIME_FEATURES = [
  ["Global virtual store", "linker=isolated + globalStore=true", "~/.bun/install/cache/links/"],
  ["process.execve()", "Replace process image in-place", "Bun ≥1.3.14 · throws in workers/Windows"],
  ["Bun.Terminal", "ConPTY on Windows", "Bun.spawn({ terminal }) now cross-platform"],
  ["using / await using", "No transpile when --target=bun", "Explicit resource management preserved"],
] as const;

const DOCS_REFERENCES = [
  ["configuration-layers", "docs/references/configuration-layers.md", "App Scaffold layer · four-layer model"],
  ["bun-runtime-scaffold", "docs/references/bun-runtime-scaffold.md", "globalStore · execve · Bun.Terminal · using/await using"],
  ["template-matrix", "docs/references/template-matrix.md", "22-file breakdown · bridge pattern · families matrix"],
  ["templates", "TEMPLATES.md", "Scaffold template inventory (manifest id templates)"],
] as const;

/** @generated canvas-routing — bun run canvas:generate; do not edit */
const CANVAS_ROUTING = [
  { id: "kimi-toolchain", page: "Hub", path: "docs/canvases/kimi-toolchain.canvas.tsx", detail: "Architecture, tools, gates — start here" },
  { id: "namespace-boundaries", page: "Meta / routing", path: "docs/canvases/namespace-boundaries.canvas.tsx", detail: "Doctor trinity · finish-work vs prefix+*" },
  { id: "configuration-layers", page: "Config SSOT", path: "docs/canvases/configuration-layers.canvas.tsx", detail: "Discovery · define · parity · scaffold layers" },
  { id: "doc-links-and-see-ladder", page: "Doc links", path: "docs/canvases/doc-links-and-see-ladder.canvas.tsx", detail: "@see ladder · docs/references index" },
  { id: "kimi-fix", page: "Scaffold", path: "docs/canvases/kimi-fix.canvas.tsx", detail: "manifest id templates (this canvas)" },
  { id: "herdr-dashboard-thumbnails", page: "Orchestrator HTTP", path: "docs/canvases/herdr-dashboard-thumbnails.canvas.tsx", detail: "PNG → Bun.Image → /api/thumbnail" },
  { id: "herdr-dashboard-automation", page: "Finish-work shell", path: "docs/canvases/herdr-dashboard-automation.canvas.tsx", detail: "kimi-doctor --automation · gate JSON" },
  { id: "herdr-unified-plugin-architecture", page: "Herdr plugins", path: "docs/canvases/herdr-unified-plugin-architecture.canvas.tsx", detail: "prefix+* · orthogonal to finish-work gates" },
  { id: "kimi-heal-doctor-scaffold", page: "Effect heal + doctor", path: "docs/canvases/kimi-heal-doctor-scaffold.canvas.tsx", detail: "Effect repair · KIMI_MODULES=doctor · perf gates" },
  { id: "dashboard-card-registry", page: "Card registry", path: "docs/canvases/dashboard-card-registry.canvas.tsx", detail: "canvasInfluences · /api/cards · lint gate" },
] as const;

/** @generated canvas-routing-meta — bun run canvas:generate; do not edit */
const CANVAS_ROUTING_COUNT = CANVAS_ROUTING.length;

const CANVAS_ROUTING_ROW_TONE = [
  "info",
  "neutral",
  "neutral",
  "warning",
  "success",
  "neutral",
  "neutral",
  "warning",
  "neutral",
  "neutral"
] as const;
const BUN_RUNTIME_SCRIPTS = [
  ["bun run check:fast", "Scaffolded gate script", "Flags before run: bun --watch run dev"],
  ["bun run --bun vite", "Force Bun runtime for Node-shebang CLIs", "Alias: -b"],
  ["precheck / postcheck", "Lifecycle hooks around scripts", "precheck failure skips script"],
  ["bun run --filter 'pkg*'", "Monorepo workspace filter", "Alias: -F"],
  ["bun --smol run …", "Lower memory, more frequent GC", "Useful on 16 GB hosts"],
] as const;

const PROFILE_COMPARE = [
  ["dx.config gates", "12 gates", "18 gates (+Herdr · effect-gates · finish-work)"],
  ["dx.config.toml", "dx.config.app.toml", "dx.config.toolchain.toml + [finishWork] [herdr]"],
  ["Scripts", "5 quality (runtime)", "+ 6 toolchain scaffold scripts"],
  ["package.json", "15 required scripts", "+ finish-work script entry"],
  ["Use when", "Apps, libraries, services", "Meta-tools, agent orchestration repos"],
] as const;

const DELEGATED_TOOLS = [
  ["kimi-governance", "fix", "LICENSE, CONTRIBUTING, CODEOWNERS, CONTEXT.md"],
  ["kimi-context-gen", "update", "CONTEXT.md freshness"],
  ["kimi-guardian", "fix", "Guardian baseline for bun.lock"],
  ["kimi-githooks", "install", "pre-commit + pre-push policy gates"],
] as const;

const TEMPLATE_FAMILIES = [
  ["bun-create", "1", "bun create kimi-toolchain", "~/.bun-create/", "Low — postinstall orchestrates"],
  ["scaffold", "22", "kimi-fix <path>", "Project root", "High with bun init — mitigated by -m"],
  ["desktop-runtime", "1", "bun run sync", "~/.kimi-code/", "None — separate namespace"],
  ["other", "4", "Manual / Herdr dashboard", "docs/herdr/ · docs/mcp/", "None"],
] as const;

const BRIDGE_PATTERN = [
  ["1", "bun init -m -y", "Minimal mode skips tsconfig · README · index · .gitignore"],
  ["2", "kimi-fix .", "Writes 22 scaffold files where !pathExists()"],
  ["3", "bun run check:fast", "Validates scaffold integrity"],
] as const;

const TOOL_SELECTOR = [
  ["New project from template", "bun create kimi-toolchain", "bun-create"],
  ["Harden existing repo", "kimi-fix .", "scaffold"],
  ["Create toolchain workspace", "kimi-fix . --profile toolchain", "scaffold"],
  ["Sync docs to agent runtime", "bun run sync", "desktop-runtime"],
  ["Bun upgrade / migration audit", "bun run scan", "scaffold · --exit-code for gates"],
  ["Author or register templates", "create-template skill", "scaffold + bun-create"],
] as const;

const ERROR_SCENARIOS = [
  ["bun init without -m", "Basic tsconfig/README/index left in place", "rm collision files && kimi-fix ."],
  ["kimi-fix after full bun init", "!pathExists skips hardened versions", "Delete tsconfig · README · index · .gitignore first"],
  ["Missing bun run sync", "kimi-doctor --probe shows 14 localDocs, not 15", "bun run sync && bun run sync:verify"],
] as const;

const SKILL_MAPPING = [
  ["kimi-toolchain", "scaffold · bun-create", "Project bootstrap and health"],
  ["create-template", "scaffold · bun-create", "Template authoring and registration"],
  ["finish-work", "scaffold scripts", "Gate execution close-loop"],
  ["herdr", "dx.config.*.toml", "Workspace orchestration"],
] as const;

const SCAFFOLD_LAYERS = [
  { category: "Config", count: 7, id: "cfg" },
  { category: "Docs", count: 5, id: "doc" },
  { category: "Source", count: 4, id: "src" },
  { category: "Scripts", count: 6, id: "scr" },
] as const;

const SCAFFOLD_TOTAL = 22;

const TOOLCHAIN_EXTRAS = [
  ["scripts/finish-work.ts", "Close-loop gates + commit/push"],
  ["scripts/finish-work-config.ts", "Gate loader from dx.config.toml"],
  ["scripts/finish-work-herdr.ts", "Herdr orchestrator handoff"],
  ["scripts/reviewer-pane.ts", "Reviewer escalation helper"],
  ["scripts/lib/bun-io.ts", "Scaffold I/O helpers"],
  ["scripts/lib/bun-utils.ts", "Scaffold parse helpers"],
] as const;

const BASE_SCRIPTS = [
  ["scripts/check.ts", "format + lint + typecheck + test gate"],
  ["scripts/run-tests.ts", "Unit / smoke / integration tiers"],
  ["scripts/test-gates.ts", "Test file registry (from toolchain)"],
  ["scripts/lint-banned-terms.ts", "Banned term policy lint"],
  ["scripts/readme-sync.ts", "README ↔ package.json script sync"],
] as const;

const CONFIG_FILES = [
  ["bunfig.toml", "Bun install + test preload · linker=isolated · globalStore=true (Bun ≥1.3.14)"],
  ["tsconfig.json", "Strict ESNext, bundler resolution"],
  [".oxfmtrc.json", "oxfmt formatter config"],
  [".oxlintrc.json", "oxlint linter config"],
  ["dx.config.toml", "DX platform + CI path (profile-specific)"],
  [".gitignore", "Node/Bun/env exclusions"],
  [".env.example", "Env var template (from .env if present)"],
] as const;

const DOCTOR_CHECKS = [
  ["AGENTS.md", "warn if missing", "fixable"],
  ["CODE_REFERENCES.md", "warn if missing", "fixable"],
  ["README.md", "warn if missing", "fixable"],
  ["tsconfig.json", "warn if missing", "fixable"],
  ["bunfig.toml", "warn if missing", "fixable"],
  ["dx.config.toml", "warn if missing", "fixable"],
  [".kimi-code/mcp.json", "warn if missing", "fixable"],
  ["src/index.ts", "warn if missing", "fixable"],
  ["scripts/check.ts", "warn if missing", "fixable"],
  ["oxfmtrc / oxlintrc", "warn if missing", "fixable"],
  ["ci.yml", "warn or ok (disabled)", "fixable unless CI disabled"],
  ["package-scripts", "19 required scripts", "fixable via ensureQualityTooling"],
] as const;

const REQUIRED_SCRIPTS = [
  "test", "test:fast", "test:coverage", "test:coverage:ci",
  "test:parallel", "test:parallel:4", "test:shard",
  "check", "check:fast", "check:dry-run", "docs:sync",
  "typecheck", "format", "format:check", "format:check:ci",
  "lint", "lint:terms", "scan", "fix",
] as const;

const DEV_DEPS = ["oxfmt", "oxlint", "typescript", "@types/bun"] as const;

const NEXT_STEPS = [
  ["1", "Review generated files before commit"],
  ["2", "Replace @team in CODEOWNERS with actual username"],
  ["3", "Add copyright holder to LICENSE"],
  ["4", "Customize AGENTS.md one-line project description"],
  ["5", "Run bun run check:fast (or bun run check for full gate)"],
  ["6", "Run kimi-governance score for project health"],
  ["7", "Run kimi-doctor --quick to verify toolchain alignment"],
  ["8", "Toolchain only: bun run finish-work --dry-run"],
] as const;

const DRIFT_WARNINGS = [
  ["app → toolchain", "Delete stale dx.config.toml + finish-work scripts, re-run with —profile toolchain"],
  ["toolchain → app", "kimi-fix will not downgrade existing [finishWork]/[herdr] sections"],
  ["Existing files", "kimi-fix never overwrites — delete target file to regenerate"],
] as const;

const PIPELINE_NODES = [
  { id: "start", label: "kimi-fix", sub: "resolve profile" },
  { id: "git", label: "git init", sub: "if no .git" },
  { id: "delegate", label: "Delegate 4 tools", sub: "parallel" },
  { id: "config", label: "Config layer", sub: "bunfig · ts · lint" },
  { id: "agents", label: "Agent docs", sub: "AGENTS · CODE_REF" },
  { id: "kimi", label: "Kimi Code stub", sub: ".kimi-code/" },
  { id: "dx", label: "dx.config.toml", sub: "profile template" },
  { id: "scripts", label: "Scripts", sub: "5 base (+6 toolchain)" },
  { id: "quality", label: "Quality inject", sub: "scripts + deps" },
  { id: "ci", label: "CI template", sub: ".github/workflows" },
  { id: "done", label: "Next steps", sub: "printed summary" },
] as const;

const PIPELINE_EDGES = [
  { from: "start", to: "git" },
  { from: "git", to: "delegate" },
  { from: "delegate", to: "config" },
  { from: "config", to: "agents" },
  { from: "agents", to: "kimi" },
  { from: "kimi", to: "dx" },
  { from: "dx", to: "scripts" },
  { from: "scripts", to: "quality" },
  { from: "quality", to: "ci" },
  { from: "ci", to: "done" },
] as const;

const BUN_CREATE_NODES = [
  { id: "tpl", label: "Local template", sub: "~/.bun-create/" },
  { id: "wipe", label: "Delete dest", sub: "destructive" },
  { id: "copy", label: "Copy skeleton", sub: "package.json only" },
  { id: "strip", label: "Strip hooks", sub: "remove bun-create" },
  { id: "hooks", label: "postinstall", sub: "global + kimi-fix" },
  { id: "git", label: "git init", sub: "initial commit" },
] as const;

const BUN_CREATE_EDGES = [
  { from: "tpl", to: "wipe" },
  { from: "wipe", to: "copy" },
  { from: "copy", to: "strip" },
  { from: "strip", to: "hooks" },
  { from: "hooks", to: "git" },
] as const;

function FixPipelineDag() {
  const theme = useHostTheme();
  const layout = computeDAGLayout({
    nodes: PIPELINE_NODES.map((n) => ({ id: n.id })),
    edges: [...PIPELINE_EDGES],
    direction: "vertical",
    nodeWidth: NODE_W,
    nodeHeight: NODE_H,
    rankGap: 36,
    nodeGap: 14,
    padding: 10,
  });

  const nodeById = Object.fromEntries(PIPELINE_NODES.map((n) => [n.id, n]));

  return (
    <div style={{ overflowX: "auto" }}>
      <svg width={layout.width} height={layout.height} role="img" aria-label="kimi-fix execution pipeline">
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
          const hub = pos.id === "delegate" || pos.id === "done";
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
                y={pos.y + 17}
                textAnchor="middle"
                fill={theme.text.primary}
                fontSize={11}
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
      <Text tone="tertiary" size="small">
        Source: src/bin/kimi-fix.ts · accent nodes = parallel delegation and handoff summary
      </Text>
    </div>
  );
}

function BunCreateFlowDag() {
  const theme = useHostTheme();
  const layout = computeDAGLayout({
    nodes: BUN_CREATE_NODES.map((n) => ({ id: n.id })),
    edges: [...BUN_CREATE_EDGES],
    direction: "vertical",
    nodeWidth: NODE_W,
    nodeHeight: NODE_H,
    rankGap: 32,
    nodeGap: 12,
    padding: 10,
  });

  const nodeById = Object.fromEntries(BUN_CREATE_NODES.map((n) => [n.id, n]));

  return (
    <div style={{ overflowX: "auto" }}>
      <svg width={layout.width} height={layout.height} role="img" aria-label="bun create local template flow">
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
          const warn = pos.id === "wipe" || pos.id === "hooks";
          return (
            <g key={pos.id}>
              <rect
                x={pos.x}
                y={pos.y}
                width={NODE_W}
                height={NODE_H}
                rx={6}
                fill={warn ? theme.fill.secondary : theme.fill.tertiary}
                stroke={warn ? theme.accent.primary : theme.stroke.primary}
                strokeWidth={warn ? 1.5 : 1}
              />
              <text
                x={pos.x + NODE_W / 2}
                y={pos.y + 17}
                textAnchor="middle"
                fill={theme.text.primary}
                fontSize={11}
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
      <Text tone="tertiary" size="small">
        Source:{" "}
        <Link href={`${BUN_CREATE_DOCS}#cli-flags`}>bun.com/docs/runtime/templating/create</Link> · accent =
        destructive wipe and kimi-fix handoff
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
        headers={["Canvas", "Topic", "Open when"]}
        rows={CANVAS_ROUTING.map((c) => [
          <CanvasLink key={`${c.id}-file`} label={`${c.id}.canvas.tsx`} path={c.path} dispatch={dispatch} />,
          <CanvasLink key={`${c.id}-page`} label={c.page} path={c.path} dispatch={dispatch} />,
          c.detail ?? c.path,
        ])}
        rowTone={[...CANVAS_ROUTING_ROW_TONE]}
        striped
      />
      <Text tone="tertiary" size="small">Click Canvas or Topic to open · profiles · templates · scaffold doctor</Text>
    </Stack>
  );
}

export default function KimiFixCanvas() {
  const toolchainScriptTotal = 5 + 6;

  return (
    <Stack gap={20} style={{ padding: 24, maxWidth: 960 }}>
      <Stack gap={8}>
        <H1>kimi-fix — project scaffold</H1>
        <Text tone="secondary">
          Auto-initialize missing Bun project files: governance, quality gates, agent docs, DX config, and CI.
          Add-only — never overwrites existing files.
        </Text>
        <Row gap={8} wrap>
          <Pill tone="info">manifest: templates</Pill>
          <Pill>{SCAFFOLD_TOTAL} scaffold files</Pill>
          <Pill>{TEMPLATE_FAMILIES.length} template families</Pill>
          <Pill>{REQUIRED_SCRIPTS.length} required scripts</Pill>
          <Pill>2 profiles</Pill>
        </Row>
        <Text tone="tertiary" size="small">
          Source: src/bin/kimi-fix.ts · docs/references/template-matrix.md · TEMPLATES.md ·
          docs/references/bun-runtime-scaffold.md
        </Text>
      </Stack>

      <Grid columns={4} gap={12}>
        <Stat label="Scaffold files" value={String(SCAFFOLD_TOTAL)} tone="info" />
        <Stat label="Config layer" value="7" />
        <Stat label="Toolchain extras" value="6" tone="warning" />
        <Stat label="Doctor checks" value={String(DOCTOR_CHECKS.length)} />
      </Grid>

      <Callout tone="info" title="Non-destructive by design">
        kimi-fix skips existing dx.config.toml, finish-work scripts, and all other present files. Profile drift
        emits warnings instead of overwriting. Use —dry-run to preview writes and delegated tool invocations.
        By contrast,{" "}
        <Link href={BUN_CREATE_DOCS}>bun create</Link> local templates delete the destination folder before copying.
      </Callout>

      <Grid columns={2} gap={16}>
        <Stack gap={12}>
          <H2>CLI surface</H2>
          <Table
            headers={["Command", "Purpose", "Flags"]}
            rows={CLI_COMMANDS.map((r) => [...r])}
            rowTone={["info", "neutral", "success"]}
            striped
          />
        </Stack>

        <Stack gap={12}>
          <H2>Entry points</H2>
          <Table
            headers={["Invocation", "Flow", "Notes"]}
            rows={ENTRY_POINTS.map((r) => [...r])}
            rowTone={["info", "success", "neutral"]}
            striped
          />
        </Stack>
      </Grid>

      <Grid columns={2} gap={16}>
        <Stack gap={12}>
          <H2>Execution pipeline</H2>
          <FixPipelineDag />
        </Stack>

        <Stack gap={12}>
          <H2>Scaffold profiles</H2>
          <Table
            headers={["Aspect", "app (default)", "toolchain"]}
            rows={PROFILE_COMPARE.map((r) => [...r])}
            rowTone={["neutral", "info", "warning", "info", "success"]}
            striped
          />
          <Text tone="tertiary" size="small">
            SSOT: templates/scaffold/ · src/lib/scaffold-templates.ts · scaffold-profiles.ts
          </Text>
        </Stack>
      </Grid>

      <CollapsibleSection title="Template families matrix" count={TEMPLATE_FAMILIES.length} defaultOpen>
        <Table
          headers={["Family", "Files", "Generated by", "Sync target", "Collision risk"]}
          rows={TEMPLATE_FAMILIES.map((r) => [...r])}
          rowTone={["neutral", "info", "success", "neutral"]}
          striped
        />
        <Table
          headers={["Scenario", "Command", "Family"]}
          rows={TOOL_SELECTOR.map((r) => [...r])}
          striped
        />
        <Text tone="tertiary" size="small">
          SSOT: docs/references/template-matrix.md · consumed by kimi-fix · create-template skill · sync-verify
        </Text>
      </CollapsibleSection>

      <CollapsibleSection title="Bridge pattern (bun init -m)" count={BRIDGE_PATTERN.length} defaultOpen={false}>
        <Callout tone="warning" title="Why -m matters">
          Without minimal mode, bun init creates basic tsconfig/README/index/.gitignore first — kimi-fix
          skips them via !pathExists(), leaving Bun defaults instead of hardened toolchain versions.
        </Callout>
        <Table headers={["Step", "Command", "Effect"]} rows={BRIDGE_PATTERN.map((r) => [...r])} striped />
        <Table headers={["Mistake", "Symptom", "Fix"]} rows={ERROR_SCENARIOS.map((r) => [...r])} rowTone={["danger", "warning", "info"]} striped />
      </CollapsibleSection>

      <CollapsibleSection title="bun create entry path" defaultOpen={false}>
        <Grid columns={2} gap={16}>
          <Stack gap={12}>
            <H3>Local template flow</H3>
            <BunCreateFlowDag />
          </Stack>
          <Stack gap={12}>
            <H3>CLI flags</H3>
            <Table headers={["Flag", "Effect"]} rows={BUN_CREATE_FLAGS.map((r) => [...r])} striped />
            <Table
              headers={["Field", "When", "Format"]}
              rows={BUN_CREATE_HOOKS.map((r) => [...r])}
              striped
            />
          </Stack>
        </Grid>
        <Table headers={["Aspect", "kimi-fix", "bun create (local)"]} rows={SCAFFOLD_CONTRAST.map((r) => [...r])} rowTone={["neutral", "success", "warning", "info"]} striped />
        <Table headers={["Step", "Phase", "Behavior"]} rows={BUN_CREATE_LOCAL_FLOW.map((r) => [...r])} striped />
        <H3>Scaffold bunfig.toml install policy</H3>
        <Table headers={["Option", "Effect"]} rows={BUN_INSTALL_OPTS.map((r) => [...r])} rowTone={["info", "success", "warning", "neutral"]} striped />
        <Table headers={["Feature", "API / config", "Notes"]} rows={BUN_RUNTIME_FEATURES.map((r) => [...r])} striped />
        <Table headers={["Command", "Purpose", "Notes"]} rows={BUN_RUNTIME_SCRIPTS.map((r) => [...r])} striped />
        <Text tone="tertiary" size="small">
          Docs: <Link href={BUN_CREATE_DOCS}>bun create</Link> ·{" "}
          <Link href={BUN_RUNTIME_DOCS}>Bun runtime</Link> · indexed reference:
          docs/references/bun-runtime-scaffold.md · skeleton: templates/bun-create/kimi-toolchain/package.json
        </Text>
      </CollapsibleSection>

      <CollapsibleSection title="Common debugging workflows" count={4} defaultOpen={false}>
        <Table headers={["Goal", "Command", "Notes"]} rows={DEBUG_WORKFLOWS.map((r) => [...r])} striped />
      </CollapsibleSection>

      <Grid columns={2} gap={16}>
        <Card>
          <CardHeader trailing={<Pill size="sm">{DELEGATED_TOOLS.length} tools</Pill>}>
            Parallel delegation
          </CardHeader>
          <CardBody style={{ padding: 0 }}>
            <Table
              headers={["Tool", "Subcommand", "Creates / updates"]}
              rows={DELEGATED_TOOLS.map((r) => [...r])}
              striped
            />
          </CardBody>
        </Card>

        <Stack gap={12}>
          <H3>Scaffold layers ({SCAFFOLD_TOTAL} files)</H3>
          <BarChart
            categories={SCAFFOLD_LAYERS.map((f) => f.category)}
            series={[
              {
                name: "templates/scaffold/ files",
                data: SCAFFOLD_LAYERS.map((f) => f.count),
                tone: "info",
              },
            ]}
            height={180}
          />
          <Text tone="tertiary" size="small">
            Source: docs/references/template-matrix.md · quality scripts (check.ts etc.) copied from runtime
            toolchain, not templates/scaffold/
          </Text>
          <UsageBar
            total={SCAFFOLD_TOTAL}
            topLeftLabel="Scaffold layer mix"
            topRightLabel={`${SCAFFOLD_TOTAL} / ${SCAFFOLD_TOTAL} files`}
            segments={SCAFFOLD_LAYERS.map((f) => ({ id: f.id, value: f.count }))}
          />
        </Stack>
      </Grid>

      <Grid columns={2} gap={16}>
        <Card>
          <CardHeader trailing={<Pill size="sm">{CONFIG_FILES.length} files</Pill>}>Config layer</CardHeader>
          <CardBody style={{ padding: 0 }}>
            <Table headers={["File", "Purpose"]} rows={CONFIG_FILES.map((r) => [...r])} striped />
          </CardBody>
        </Card>

        <Card>
          <CardHeader trailing={<Pill size="sm">{BASE_SCRIPTS.length} scripts</Pill>}>Quality scripts (both profiles)</CardHeader>
          <CardBody style={{ padding: 0 }}>
            <Table headers={["Script", "Role"]} rows={BASE_SCRIPTS.map((r) => [...r])} striped />
          </CardBody>
        </Card>
      </Grid>

      <CollapsibleSection title="Toolchain profile extras (+6 scripts)" defaultOpen={false}>
        <Table
          headers={["Path", "Purpose"]}
          rows={TOOLCHAIN_EXTRAS.map((r) => [...r])}
          rowTone={["warning", "neutral", "neutral", "neutral", "neutral", "neutral"]}
          striped
        />
        <Text tone="tertiary" size="small" style={{ marginTop: 8 }}>
          Total scripts when profile=toolchain: {toolchainScriptTotal} · adds finish-work close-loop and Herdr
          handoff
        </Text>
      </CollapsibleSection>

      <Grid columns={2} gap={16}>
        <Card>
          <CardHeader trailing={<Pill size="sm">kimi-fix doctor</Pill>}>Scaffold doctor checks</CardHeader>
          <CardBody style={{ padding: 0 }}>
            <Table
              headers={["Check", "Status rule", "Repair"]}
              rows={DOCTOR_CHECKS.map((r) => [...r])}
              striped
            />
          </CardBody>
        </Card>

        <Stack gap={12}>
          <H3>package.json injection</H3>
          <Text tone="secondary" size="small">
            ensureQualityTooling adds missing scripts and installs devDependencies via bun add -d.
          </Text>
          <Table
            headers={["Required scripts", "Count"]}
            rows={[[REQUIRED_SCRIPTS.join(", "), String(REQUIRED_SCRIPTS.length)]]}
            striped
          />
          <Table
            headers={["Dev dependencies", "Installed when missing"]}
            rows={[[DEV_DEPS.join(", "), "via bun add -d"]]}
            striped
          />
          <Text tone="tertiary" size="small">
            Source: src/lib/scaffold-quality.ts · toolchain profile also adds finish-work script
          </Text>
        </Stack>
      </Grid>

      <CollapsibleSection title="Migration, next steps, source map" defaultOpen={false}>
        <Table headers={["Scenario", "Resolution"]} rows={DRIFT_WARNINGS.map((r) => [...r])} rowTone={["warning", "neutral", "info"]} striped />
        <Table headers={["Step", "Action"]} rows={NEXT_STEPS.map((r) => [...r])} striped />
        <Table
          headers={["Module", "Role"]}
          rows={[
            ["src/bin/kimi-fix.ts", "CLI entry — fix + doctor"],
            ["src/lib/scaffold-templates.ts", "Template SSOT from templates/scaffold/"],
            ["src/lib/scaffold-profiles.ts", "app vs toolchain rendering + drift detection"],
            ["src/lib/scaffold-doctor.ts", "checkScaffold health checks"],
            ["src/lib/scaffold-quality.ts", "package.json scripts + devDeps injection"],
            ["TEMPLATES.md", "Human-readable scaffold reference"],
            ["docs/references/configuration-layers.md", "App Scaffold layer · manifest id configuration-layers"],
            ["docs/references/template-matrix.md", "22-file breakdown · bridge pattern · verification gate"],
            ["docs/references/bun-runtime-scaffold.md", "globalStore · execve · Bun.Terminal · using/await using"],
          ]}
          striped
        />
        <Table headers={["Skill", "Consumes", "Why"]} rows={SKILL_MAPPING.map((r) => [...r])} striped />
      </CollapsibleSection>

      <CollapsibleSection title="docs/references (scaffold)" count={DOCS_REFERENCES.length} defaultOpen={false}>
        <Table
          headers={["Manifest id", "Path", "One-line"]}
          rows={DOCS_REFERENCES.map((r) => [...r])}
          rowTone={["info", "info", "success", "neutral"]}
          striped
        />
      </CollapsibleSection>

      <CollapsibleSection title={`Related canvases (${CANVAS_ROUTING_COUNT} manifest-backed)`} count={CANVAS_ROUTING_COUNT} defaultOpen={false}>
        <RelatedCanvasesTable />
      </CollapsibleSection>
    </Stack>
  );
}
