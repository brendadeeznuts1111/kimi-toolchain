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
  H3,
  Pill,
  Row,
  Stack,
  Stat,
  Table,
  Text,
  useCanvasAction,
  useHostTheme,
} from "cursor/canvas";

const CANVAS_PREFIX = "docs/canvases/";

const RULE_COUNT = 2;
const CONSTANT_COUNT = 4;
const URL_FIELD_COUNT = 8;
const TEST_COUNT = 15;

const PIPELINE_STEPS = [
  ["1", "src/**/*.ts line", "scripts/lint-doc-links.ts · scoped lint --files"],
  ["2", "extractDocLinkUrls", "Absolute https?://… plus bare bun.sh/docs in code"],
  ["3", "parseDocLinkUrl", "new URL() → protocol … hash (URLPattern parts)"],
  ["4a", "prefer-bun-com-docs", "hostname bun.sh + pathname /docs…"],
  ["4b", "use-doc-constant", "BUN_DOC_LINK_CONSTANTS match · non-comment code only"],
] as const;

const URL_COMPONENT_EXAMPLE = [
  ["protocol", "https:"],
  ["username", "user"],
  ["password", "pass"],
  ["hostname", "bun.com"],
  ["port", '"" (default 443)'],
  ["pathname", "/docs/runtime/webview"],
  ["search", "?q=1"],
  ["hash", "#console-capture"],
] as const;

const RULES_MATRIX = [
  [
    "prefer-bun-com-docs",
    "hostname === bun.sh && pathname starts with /docs",
    "canonical-references.toml / data.ts ecosystem root; bare bun.sh/docs prose in comments",
  ],
  [
    "use-doc-constant",
    "docLinkUrlMatchesSpec vs BUN_DOC_LINK_CONSTANTS",
    "JSDoc @see in comments; export const in defining file; line uses constant name",
  ],
] as const;

const REGISTERED_CONSTANTS = [
  [
    "BUN_WEBVIEW_DOCS_URL",
    "src/lib/webview-console.ts",
    "bun.sh · bun.com",
    "/docs/runtime/webview",
  ],
  ["BUN_INSTALL_DOC_URL", "src/lib/bun-install-config.ts", "bun.com", "/docs/pm/cli/install"],
  ["BUN_IMAGE_DOCS_URL", "src/lib/bun-image.ts", "bun.com", "/docs/runtime/image"],
  ["BUN_GUIDES_INDEX_DOC_URL", "src/lib/cli-contract.ts", "bun.com", "/guides"],
] as const;

const SEE_LADDER = [
  ["Global platform / project config", "@see dx", "~/.config/dx/AGENTS.md · ecosystem id dx"],
  [
    "Four-layer config model",
    "@see docs/references/configuration-layers.md",
    "Discovery · define · parity · scaffold",
  ],
  [
    "Gate strings in [finishWork]",
    "@see docs/references/kimi-doctor.md",
    "Shell gates only — not plugin prefix+d",
  ],
  [
    "Doctor / orchestrator name clash",
    "@see namespace-boundaries",
    "Name collision resolver · namespace canvas",
  ],
  [
    "Bun install / bun create flags",
    "@see docs/references/bun-runtime-scaffold.md",
    "bunfig.toml merge · lazy install · backend",
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

const DOC_LINKS_SEE = [
  [
    "Bun docs in executable code",
    "Use BUN_*_DOC_URL",
    "lint:doc-links enforces via use-doc-constant",
  ],
  [
    "Bun docs in JSDoc @see (bun.com)",
    "Raw #fragment URLs OK",
    "use-doc-constant comment exemption",
  ],
  [
    "Legacy bun.sh in JSDoc @see",
    "Absolute https://bun.sh/… still flags",
    "prefer-bun-com-docs — migrate to bun.com",
  ],
  ["Ecosystem manifest root", 'docs: "https://bun.sh/docs"', "canonical-references.toml / data.ts"],
  [
    "Bun guides hub",
    "https://bun.com/guides (bun.com/docs/guides redirects)",
    "BUN_GUIDES_INDEX_DOC_URL · argv/stdin/stdout under /guides/…",
  ],
  [
    "dx URL inventory rows",
    "[[endpoints]] in dx.config.toml",
    "schemas/endpoints-strict.schema.toml gate",
  ],
] as const;

const SEE_DX_VERBAGE = [
  ["@see dx suffices", "dx config · mcp-status · [finishWork] · [herdr] · [[endpoints]]"],
  ["@see dx not enough", "Same word, different executable (doctor, orchestrator)"],
  ["Escalate to namespace", "Shell gate vs prefix+d vs /api/* vs [[endpoints]]"],
  ["dx names where", "namespace names what runs"],
] as const;

const DOCS_REFERENCES = [
  [
    "configuration-layers",
    "docs/references/configuration-layers.md",
    "Four-layer model · config:status",
  ],
  ["namespace", "docs/references/namespace.md", "Toolchain vs Herdr · doctor trinity · @see hub"],
  ["kimi-doctor", "docs/references/kimi-doctor.md", "--automation gate · finish-work shell gates"],
  ["dashboard-thumbnails", "docs/references/dashboard-thumbnails.md", "Bun.Image · /api/thumbnail"],
  [
    "shell-spawn-choice",
    "docs/references/shell-spawn-choice.md",
    "invokeTool vs Bun.spawn vs governedSpawn",
  ],
  [
    "bun-runtime-scaffold",
    "docs/references/bun-runtime-scaffold.md",
    "globalStore · execve · Bun.Terminal · using/await using",
  ],
  [
    "bun-shell-companions",
    "docs/references/bun-shell-companions.md",
    "Bun $ template vs subprocess",
  ],
  [
    "template-matrix",
    "docs/references/template-matrix.md",
    "22-file scaffold · bridge pattern · families",
  ],
  [
    "herdr-plugin-architecture",
    "docs/references/herdr-plugin-architecture.md",
    "Herdr plugins v0.5.0 · prefix+* · orthogonal to gates",
  ],
] as const;

const DOCS_REFERENCES_COUNT = DOCS_REFERENCES.length;

const SCHEMAS = [
  [
    "endpoints-strict.schema.toml",
    "schemas/endpoints-strict.schema.toml",
    "Pathname safety for [[endpoints]] · dx:table -u --exact",
  ],
  ["endpoints.schema.toml", "schemas/endpoints.schema.toml", "Looser endpoint table shape"],
  ["README", "schemas/README.md", "Schema inventory for dx:table --schema"],
] as const;

const TEST_LOCKIN = [
  ["parseDocLinkUrl decomposes URLPattern component fields", "8 URL fields from new URL()"],
  ["docLinkUrlMatchesSpec pathnamePrefix", "Component-wise match spec"],
  ["extractDocLinkUrls bare bun.sh/docs", "Code-line extraction without scheme"],
  ["allows bun.sh/docs root in canonical-references-data.ts", "Ecosystem root allowlist"],
  ["flags bun.sh/docs deep links outside allowlist", "Absolute https://bun.sh in @see still flags"],
  ["allows bare bun.sh/docs prose in comments", "Self-lint safe · prose exemption"],
  ["allows constant definition in defining module", "BUN_WEBVIEW_DOCS_URL export line"],
  ["allows BUN_INSTALL_DOC_URL in bun-install-config.ts", "Install constant defining file"],
  ["flags raw install doc URL in consumer modules", "use-doc-constant on code"],
  ["allows BUN_IMAGE_DOCS_URL in bun-image.ts", "Image constant defining file"],
  ["flags raw image doc URL in consumer modules", "use-doc-constant on code"],
  ["flags raw webview URL in consumer modules", "use-doc-constant on code"],
  ["flags http webview URL (protocol-agnostic)", "Default http: + https:"],
  ["allows consumer lines referencing constant", "Line includes constant name"],
  ["allows JSDoc @see deep links in comments", "Comment exemption path"],
] as const;

const CLI_DOC_LINKS = [
  ["Library", "src/lib/doc-links-lint.ts", "scanDocLinkFile · lintDocLinks · parseDocLinkUrl"],
  ["Scoped filter", "src/lib/check-lint-scoped.ts", "filterDocLinkPaths (src/**/*.ts only)"],
  ["Standalone script", "scripts/lint-doc-links.ts", "lintDocLinks(root) · optional file args"],
  ["package.json", "bun run lint:doc-links", "Full src/**/*.ts scan"],
  ["package.json", "bun run lint:doc-links -- src/lib/foo.ts", "Single-file scan"],
  ["Unified lint (full)", "bun run lint", "Sub-step doc-links in scripts/lint.ts runFullLint"],
  [
    "Unified lint (scoped)",
    "bun run lint --files …",
    "filterDocLinkPaths → lintDocLinks(onlyFiles)",
  ],
  ["Fast check (full)", "bun run check:fast", "check-pipeline → bun run lint"],
  ["Fast check (changed)", "bun run check:fast:changed", "bun run lint --files <changed>"],
  ["Pre-commit hook", "kimi-githooks pre-commit", "format:check + lint (full) + typecheck"],
  ["Unit test", "bun test test/doc-links-lint.unit.test.ts", "Direct scanDocLinkFile · 15 cases"],
] as const;

const CLI_SEE_LADDER = [
  [
    "URL table decompose",
    "bun run dx:table -u",
    "src/lib/url-decomposer.ts · dx.config.toml [[endpoints]]",
  ],
  ["Endpoints schema gate", "bun run dx:table:contract", "schemas/endpoints-strict.schema.toml"],
  ["Manifest regenerate", "bun run references:generate", "canonical-references.json from SSOT"],
  ["Agent discovery", "kimi-doctor --probe", "canonicalReferences embed"],
] as const;

/** @generated canvas-routing — bun run canvas:generate; do not edit */
const CANVAS_ROUTING = [
  {
    id: "kimi-toolchain",
    page: "Hub",
    version: "0.1.0",
    layer: "Project hub",
    openWhen: "Architecture, tools, gates — start here",
    path: `${CANVAS_PREFIX}kimi-toolchain.canvas.tsx`,
    repoPath: `${CANVAS_PREFIX}kimi-toolchain.canvas.tsx`,
  },
  {
    id: "namespace-boundaries",
    page: "Meta / routing",
    version: "0.1.0",
    layer: "Meta / routing",
    openWhen: "Doctor trinity · finish-work vs prefix+*",
    path: `${CANVAS_PREFIX}namespace-boundaries.canvas.tsx`,
    repoPath: `${CANVAS_PREFIX}namespace-boundaries.canvas.tsx`,
  },
  {
    id: "configuration-layers",
    page: "Config SSOT",
    version: "1.0.0",
    layer: "Config SSOT",
    openWhen: "Discovery · define · parity · scaffold layers",
    path: `${CANVAS_PREFIX}configuration-layers.canvas.tsx`,
    repoPath: `${CANVAS_PREFIX}configuration-layers.canvas.tsx`,
  },
  {
    id: "doc-links-and-see-ladder",
    page: "Doc links",
    version: "0.1.0",
    layer: "Doc URL lint",
    openWhen: "@see ladder · docs/references index",
    path: `${CANVAS_PREFIX}doc-links-and-see-ladder.canvas.tsx`,
    repoPath: `${CANVAS_PREFIX}doc-links-and-see-ladder.canvas.tsx`,
  },
  {
    id: "kimi-fix",
    page: "Scaffold",
    version: "0.1.0",
    layer: "kimi-fix · bun create",
    openWhen: "Profiles · templates · scaffold doctor",
    path: `${CANVAS_PREFIX}kimi-fix.canvas.tsx`,
    repoPath: `${CANVAS_PREFIX}kimi-fix.canvas.tsx`,
  },
  {
    id: "herdr-dashboard-thumbnails",
    page: "Orchestrator HTTP",
    version: "0.1.0",
    layer: "Orchestrator HTTP",
    openWhen: "PNG → Bun.Image → /api/thumbnail",
    path: `${CANVAS_PREFIX}herdr-dashboard-thumbnails.canvas.tsx`,
    repoPath: `${CANVAS_PREFIX}herdr-dashboard-thumbnails.canvas.tsx`,
  },
  {
    id: "herdr-dashboard-automation",
    page: "Finish-work shell",
    version: "1.0.0",
    layer: "Finish-work shell",
    openWhen: "kimi-doctor --automation · gate JSON",
    path: `${CANVAS_PREFIX}herdr-dashboard-automation.canvas.tsx`,
    repoPath: `${CANVAS_PREFIX}herdr-dashboard-automation.canvas.tsx`,
  },
  {
    id: "herdr-unified-plugin-architecture",
    page: "Herdr plugins",
    version: "0.5.0",
    layer: "Herdr plugins v0.5.0",
    openWhen: "prefix+* · orthogonal to finish-work gates",
    path: `${CANVAS_PREFIX}herdr-unified-plugin-architecture.canvas.tsx`,
    repoPath: `${CANVAS_PREFIX}herdr-unified-plugin-architecture.canvas.tsx`,
  },
  {
    id: "kimi-heal-doctor-scaffold",
    page: "Effect heal + doctor",
    version: "0.1.0",
    layer: "kimi-heal --fix · doctor scaffold",
    openWhen: "Effect repair · KIMI_MODULES=doctor · perf gates",
    path: `${CANVAS_PREFIX}kimi-heal-doctor-scaffold.canvas.tsx`,
    repoPath: `${CANVAS_PREFIX}kimi-heal-doctor-scaffold.canvas.tsx`,
  },
  {
    id: "dashboard-card-registry",
    page: "Dashboard card registry",
    version: "0.1.0",
    layer: "Card registry",
    openWhen: "Canvas↔card wiring · influence coverage",
    path: `${CANVAS_PREFIX}dashboard-card-registry.canvas.tsx`,
    repoPath: `${CANVAS_PREFIX}dashboard-card-registry.canvas.tsx`,
  },
  {
    id: "artifact-lineage",
    page: "Artifacts & Runs",
    version: "1.0.0",
    layer: "Artifact nervous system",
    openWhen: "Run manifests · /api/artifacts · /api/runs · lineage URLPatterns",
    path: `${CANVAS_PREFIX}artifact-lineage.canvas.tsx`,
    repoPath: `${CANVAS_PREFIX}artifact-lineage.canvas.tsx`,
  },
  {
    id: "gate-health",
    page: "Gate Health",
    version: "1.0.0",
    layer: "Effect gates probe",
    openWhen: "GET /api/doctor/gates · #gate-health overlay · 30s poll",
    path: `${CANVAS_PREFIX}gate-health.canvas.tsx`,
    repoPath: `${CANVAS_PREFIX}gate-health.canvas.tsx`,
  },
  {
    id: "benchmark",
    page: "Effect Benchmark",
    version: "1.0.0",
    layer: "Perf gates probe",
    openWhen: "GET /api/effect-benchmark · serve-probe · 30s poll",
    path: `${CANVAS_PREFIX}benchmark.canvas.tsx`,
    repoPath: `${CANVAS_PREFIX}benchmark.canvas.tsx`,
  },
] as const;

/** @generated canvas-routing-meta — bun run canvas:generate; do not edit */
const CANVAS_ROUTING_COUNT = CANVAS_ROUTING.length;

const CANVAS_ROW_TONE = [
  "info",
  "neutral",
  "neutral",
  "success",
  "neutral",
  "neutral",
  "neutral",
  "warning",
  "neutral",
  "neutral",
  "neutral",
  "neutral",
  "neutral",
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
        headers={["Canvas", "Page", "Version", "Layer", "Open when"]}
        rows={CANVAS_ROUTING.map((canvas) => [
          <span key={`${canvas.id}-file`}>
            <CanvasNavButton
              label={`${canvas.id}.canvas.tsx`}
              path={canvas.path}
              dispatch={dispatch}
            />
          </span>,
          <span key={`${canvas.id}-page`}>
            <CanvasNavButton label={canvas.page} path={canvas.path} dispatch={dispatch} />
          </span>,
          canvas.version,
          canvas.layer,
          canvas.openWhen,
        ])}
        rowTone={[...CANVAS_ROW_TONE]}
        striped
      />
      <Text tone="tertiary" size="small">
        Click <Text weight="semibold">Canvas</Text> or <Text weight="semibold">Page</Text> to open
        the target canvas in the IDE · repo mirrors under docs/canvases/ for manifest{" "}
        <Text weight="semibold">cursorCanvas</Text> ids · source: canonical-references.json
        localDocs
      </Text>
    </Stack>
  );
}

function PipelineSteps() {
  const theme = useHostTheme();
  return (
    <Stack gap={8}>
      {PIPELINE_STEPS.map(([step, title, detail]) => (
        <div key={step}>
          <Row gap={12} style={{ alignItems: "flex-start" }}>
            <div
              style={{
                minWidth: 28,
                height: 28,
                borderRadius: 4,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: step.startsWith("4") ? theme.fill.secondary : theme.fill.tertiary,
                border: `1px solid ${step.startsWith("4") ? theme.accent.primary : theme.stroke.primary}`,
                color: theme.text.primary,
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {step}
            </div>
            <Stack gap={2} style={{ flex: 1 }}>
              <Text weight="semibold">{title}</Text>
              <Text tone="tertiary" size="small">
                {detail}
              </Text>
            </Stack>
          </Row>
        </div>
      ))}
      <Text tone="tertiary" size="small">
        Source: src/lib/doc-links-lint.ts scanDocLinkFile · lines 179–224
      </Text>
    </Stack>
  );
}

export default function DocLinksAndSeeLadderCanvas() {
  return (
    <Stack gap={20} style={{ padding: 24, maxWidth: 960 }}>
      <Stack gap={8}>
        <H1>Doc links lint and @see ladder</H1>
        <Text tone="secondary">
          src/lib/doc-links-lint.ts · bun run lint:doc-links · scoped via bun run lint --files …
        </Text>
        <Row gap={8} wrap>
          <Pill>{RULE_COUNT} rules</Pill>
          <Pill>{CONSTANT_COUNT} registered constants</Pill>
          <Pill>{URL_FIELD_COUNT} URL fields</Pill>
          <Pill>{TEST_COUNT} unit tests</Pill>
        </Row>
      </Stack>

      <Grid columns={4} gap={12}>
        <Stat label="Rules" value={String(RULE_COUNT)} tone="info" />
        <Stat label="Constants" value={String(CONSTANT_COUNT)} />
        <Stat label="URL fields" value={String(URL_FIELD_COUNT)} />
        <Stat label="Unit tests" value={String(TEST_COUNT)} tone="success" />
      </Grid>

      <Card>
        <CardHeader trailing={<Pill size="sm">CLI map</Pill>}>Library → scripts → gates</CardHeader>
        <CardBody style={{ padding: 0 }}>
          <Table
            headers={["Layer", "Invoke", "Resolves to"]}
            rows={CLI_DOC_LINKS.map((r) => [...r])}
            rowTone={[
              "info",
              "neutral",
              "neutral",
              "info",
              "neutral",
              "info",
              "success",
              "neutral",
              "success",
              "warning",
              "success",
            ]}
            striped
          />
          <Text tone="tertiary" size="small" style={{ padding: 12 }}>
            No kimi-toolchain doc-links subcommand — use bun run lint:doc-links or bun run lint.
          </Text>
        </CardBody>
      </Card>

      <Card>
        <CardHeader trailing={<Pill size="sm">@see ladder CLI</Pill>}>Related commands</CardHeader>
        <CardBody style={{ padding: 0 }}>
          <Table
            headers={["Purpose", "Command", "Module / artifact"]}
            rows={CLI_SEE_LADDER.map((r) => [...r])}
            striped
          />
        </CardBody>
      </Card>

      <Grid columns={2} gap={16}>
        <Card>
          <CardHeader trailing={<Pill size="sm">scan pipeline</Pill>}>
            Line → parts → rules
          </CardHeader>
          <CardBody>
            <PipelineSteps />
          </CardBody>
        </Card>

        <Stack gap={12}>
          <H2>URL component fields</H2>
          <Text tone="secondary" size="small">
            Example: https://user:pass@bun.com/docs/runtime/webview?q=1#console-capture
          </Text>
          <Table
            headers={["Field", "Parsed value"]}
            rows={URL_COMPONENT_EXAMPLE.map((r) => [...r])}
            striped
          />
          <Callout tone="info" title="URLPattern alignment">
            Same decomposition as URLPattern parts via new URL(). url-decomposer.ts @see
            bun.com/blog/bun-v1.3.12 (root). doc-links-lint.ts has no @see yet — optional anchor
            #urlpattern-is-up-to-2-3x-faster.
          </Callout>
        </Stack>
      </Grid>

      <Grid columns={2} gap={16}>
        <Card>
          <CardHeader trailing={<Pill size="sm">2 rules</Pill>}>Rules and exemptions</CardHeader>
          <CardBody style={{ padding: 0 }}>
            <Table
              headers={["Rule", "Match", "Exemptions"]}
              rows={RULES_MATRIX.map((r) => [...r])}
              rowTone={["warning", "info"]}
              striped
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader trailing={<Pill size="sm">{CONSTANT_COUNT} ids</Pill>}>
            BUN_DOC_LINK_CONSTANTS
          </CardHeader>
          <CardBody style={{ padding: 0 }}>
            <Table
              headers={["Constant", "Defining file", "Hostnames", "pathnamePrefix"]}
              rows={REGISTERED_CONSTANTS.map((r) => [...r])}
              striped
            />
            <Text tone="tertiary" size="small" style={{ padding: 12 }}>
              Default protocols: http: + https:. SSOT: src/lib/doc-links-lint.ts
              BUN_DOC_LINK_CONSTANTS.
            </Text>
          </CardBody>
        </Card>
      </Grid>

      <Grid columns={2} gap={16}>
        <Card>
          <CardHeader trailing={<Pill size="sm">@see ladder</Pill>}>Cross-ref by intent</CardHeader>
          <CardBody style={{ padding: 0 }}>
            <Table
              headers={["Intent", "Minimal @see", "Resolves to"]}
              rows={SEE_LADDER.map((r) => [...r])}
              rowTone={["neutral", "info", "info", "info", "neutral", "neutral", "neutral"]}
              striped
            />
          </CardBody>
        </Card>

        <Stack gap={12}>
          <H2>Doc-links vs @see</H2>
          <Table
            headers={["Surface", "Pattern", "Lint"]}
            rows={DOC_LINKS_SEE.map((r) => [...r])}
            striped
          />
          <H3>@see dx — when it is enough</H3>
          <Table headers={["Rule", "Meaning"]} rows={SEE_DX_VERBAGE.map((r) => [...r])} striped />
        </Stack>
      </Grid>

      <Grid columns={2} gap={16}>
        <Card>
          <CardHeader trailing={<Pill size="sm">{DOCS_REFERENCES_COUNT} ids</Pill>}>
            docs/references/
          </CardHeader>
          <CardBody style={{ padding: 0 }}>
            <Table
              headers={["Manifest id", "Path", "One-line"]}
              rows={DOCS_REFERENCES.map((r) => [...r])}
              rowTone={DOCS_REFERENCES.map((r) =>
                r[0] === "namespace" ||
                r[0] === "configuration-layers" ||
                r[0] === "dashboard-thumbnails"
                  ? "info"
                  : "neutral"
              )}
              striped
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader trailing={<Pill size="sm">3 files</Pill>}>schemas/</CardHeader>
          <CardBody style={{ padding: 0 }}>
            <Table
              headers={["Artifact", "Path", "Role"]}
              rows={SCHEMAS.map((r) => [...r])}
              striped
            />
            <Text tone="tertiary" size="small" style={{ padding: 12 }}>
              Gate: bun run dx:table:contract · @see schemas/endpoints-strict.schema.toml in @see
              ladder row 7
            </Text>
          </CardBody>
        </Card>
      </Grid>

      <CollapsibleSection title="Related canvases" count={CANVAS_ROUTING_COUNT} defaultOpen>
        <RelatedCanvasesTable />
      </CollapsibleSection>

      <CollapsibleSection title={`Test lock-in (${TEST_COUNT} cases)`} defaultOpen={false}>
        <Table headers={["Test name", "Mechanism"]} rows={TEST_LOCKIN.map((r) => [...r])} striped />
        <Text tone="tertiary" size="small" style={{ marginTop: 8 }}>
          bun test test/doc-links-lint.unit.test.ts · bun run lint:doc-links · scoped lint in
          check-lint-scoped.ts
        </Text>
      </CollapsibleSection>

      <CollapsibleSection title="SSOT pipeline" defaultOpen={false}>
        <Table
          headers={["Step", "Command / path"]}
          rows={[
            ["Doc-links scanner", "src/lib/doc-links-lint.ts"],
            ["CLI wrapper", "scripts/lint-doc-links.ts"],
            ["Full gate", "bun run lint:doc-links"],
            ["Scoped gate", "bun run lint --files src/…"],
            ["Manifest SSOT", "canonical-references.toml"],
            ["Hub doc", "docs/references/namespace.md"],
            ["Endpoints schema", "schemas/endpoints-strict.schema.toml"],
            ["URL table decompose", "src/lib/url-decomposer.ts · dx:table -u"],
          ]}
          striped
        />
      </CollapsibleSection>
    </Stack>
  );
}
