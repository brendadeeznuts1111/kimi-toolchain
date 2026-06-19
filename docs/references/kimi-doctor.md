# kimi-doctor dashboard-automation gate

## Not to be confused with

- **`herdr-doctor` plugin** — Herdr UI plugin (`prefix+d`), not this CLI. `@see namespace-boundaries` → [Doctor trinity](./namespace.md#doctor-trinity--kimi-code) · [Name collision resolver](./namespace.md#name-collision-resolver).

## Primary command

```bash
kimi-doctor --automation
```

This runs the self-contained end-to-end dashboard automation gate. It:

- Starts a temporary herdr dashboard server with an ephemeral headless `Bun.WebView`
  (Chrome or WebKit backend)
- Waits for the dashboard ready gate (`#agents-body` + `__HERDR_DASHBOARD_READY__`)
- Runs the processes-panel smoke recipe (toggle `#processes-toggle`, wait for rows)
- Captures a screenshot using `Bun.WebView.screenshot()` via `webViewScreenshotBytes()`
- Feeds the PNG into `setScreenshotPng` and probes `GET /api/thumbnail` to verify the
  `dashboardWebpThumbnail` pipeline returns `image/webp` (encode runs via awaited
  `.blob()` terminal on the server — see [dashboard-thumbnails.md Terminals](./dashboard-thumbnails.md#terminals))
- Reports a pass/fail result

The gate is the canonical fast check for the dashboard's screenshot-to-thumbnail
pipeline and process panel rendering.

### Optional arguments

| Flag | Effect |
| ---- | ------ |
| `--url <http://127.0.0.1:18412/>` | Use an already-running dashboard server instead of starting a new one. UI smoke still runs, but the gate cannot call `setScreenshotPng` on a remote process — the thumbnail probe only passes if the server already has a screenshot feed (e.g. `--webview` mode). For full E2E on a serve shell, omit `--url`. |
| `--dashboard-url` | Alias for `--url` (same resolution as dashboard-meta gate) |
| `--json` | Emit structured JSON (see schema below) instead of human-readable output |

URL resolution order: `--url` → `--dashboard-url` → `HERDR_DASHBOARD_URL` → ephemeral server (port 0).

---

## JSON output schema (`--automation --json`)

```json
{
  "schemaVersion": 1,
  "tool": "kimi-doctor",
  "dashboardAutomation": { "…": "…" },
  "summary": { "ok": true }
}
```

### `dashboardAutomation` object

| Field | Type | Description |
| ----- | ---- | ----------- |
| `ok` | boolean | Overall pass/fail |
| `url` | string | Dashboard base URL (ephemeral or external) |
| `ownedServer` | boolean | `true` if the gate started its own server (default) |
| `smoke` | object? | Present on successful UI smoke test |
| `smoke.pngBytes` | number | Size of the captured screenshot PNG (bytes); `0` in external `--url` mode when feed is skipped |
| `smoke.bodyRowCount` | number | Number of `<tr>` elements inside `#processes-body` |
| `smoke.processRowCount` | number | Number of `.processes-row` elements |
| `thumbnail` | object? | Result of the `/api/thumbnail` probe |
| `thumbnail.ok` | boolean | |
| `thumbnail.status` | number | HTTP status code |
| `thumbnail.contentType` | string? | `image/webp` on success |
| `thumbnail.cache` | string? | Cache status from `x-thumbnail-cache` header: `"hit"` or `"miss"` |
| `failure` | object? | Present when `ok` is `false` |
| `failure.code` | string | Failure code (see below) |
| `failure.message` | string | Human-readable description |
| `failure.detail` | string? | Additional detail (e.g. external `--url` limitation) |

**Not included:** `ready`, `agentRows`, `screenshotBytes`, `thumbnailBytes`,
`thumbnailPath`, `backend`, `profile`, or `dashboardUrl`. Those belong to the
lower-level orchestrator probe (`herdr-orchestrator dashboard --probe`), not to
the doctor gate.

---

## Exit codes

| Code | Meaning |
| ---- | ------- |
| 0 | Gate passed (`result.ok === true`) |
| 1 | Gate failed, or adapter failure (always 0/1, no finer granularity) |

---

## Failure codes

| Code | When |
| ---- | ---- |
| `webview_unsupported` | `Bun.WebView` is not available on this platform |
| `bun_image_unsupported` | `Bun.Image` is not available (thumbnail encoding impossible) |
| `smoke_failed` | Ready gate, UI action, or screenshot threw an error, or zero rows found |
| `thumbnail_unavailable` | `/api/thumbnail` never returned HTTP 200 with `image/webp` |
| `thumbnail_invalid` | `/api/thumbnail` returned 200 but with wrong content type |

Typical human-mode messages:

- `"Bun.WebView is not available on this platform"`
- `"Bun.Image is not available — /api/thumbnail encode cannot run"`
- `"dashboard ready gate timed out"` / `"processes panel did not render rows after toggle"` / `"smoke automation produced no screenshot"` (all → `smoke_failed`)
- `"GET …/api/thumbnail did not return image/webp"` (+ `detail` about external `--url`)
- `"dashboard automation ran but /api/thumbnail did not return image/webp"` (owned server)

---

## Adapter mode (secondary)

```bash
kimi-doctor --adapter dashboard-automation
```

Wraps `--automation --json` in a subprocess and maps the result into a
`HealthCheck[]` entry for `--all` aggregations.

Adapter JSON output:

```json
{
  "schemaVersion": 1,
  "tool": "kimi-doctor",
  "mode": "adapter",
  "adapter": "dashboard-automation",
  "checks": [
    {
      "name": "dashboard-automation",
      "status": "ok",
      "message": "…"
    }
  ],
  "durationMs": 1234,
  "summary": { "ok": true }
}
```

The raw `dashboardAutomation` object from the subprocess is not re-emitted at
the top level; it is retained in the adapter's internal `rawOutput`.

The adapter has a default timeout of 60 s. If it expires, the check shows:
`"adapter dashboard-automation timed out after …ms"`.

---

## Live dashboard gate-health

When the Herdr dashboard server is running, the **gate-health overlay** (banner on
the Agents tab) and the **Metrics** tab poll two HTTP routes. These are runtime
probes — not finish-work gates and not the same as `--automation` or
`--dashboard-meta`.

### `GET /api/doctor/gates`

Runs a lightweight effect-gates check against the dashboard's `projectPath`:

```bash
kimi-doctor --effect-gates --json --project-root <projectPath>
```

Implementation: `fetchDashboardGateHealth()` in `src/lib/herdr-dashboard-data.ts`.
Route handler: `src/lib/herdr-dashboard-server.ts`.

**Response shape** (`DashboardGateCheckPayload`):

| Field | Type | Description |
| ----- | ---- | ----------- |
| `ok` | boolean | Probe completed (doctor found and subprocess ran) |
| `failed` | boolean | One or more gates are failing |
| `failures` | `{ name, message }[]` | Failing gate names and messages |
| `total` | number | Total gates in the effect-gates summary |
| `fetchedAt` | string | ISO timestamp |

The browser overlay (`#gate-health` in `templates/herdr-dashboard.js`) polls this
route every **30 s**, highlights failing agent rows, and shows
`N/total failing: <names>`.

The server also runs the same probe in the background via
`startDashboardGateHealthWatch()` (`src/lib/herdr-dashboard-gate-watch.ts`). On
state transitions it emits typed bus events:

| Bus event | When | Audit type |
| --------- | ---- | ---------- |
| `gate:failed` | First failure, pass→fail, or failure-set change | `gate.failed` |
| `gate:cleared` | Fail→pass | `gate.cleared` |

Disable the server watch with `gateHealthWatch: false` on
`startHerdrDashboardServer()` (tests).

### `GET /api/metrics`

Returns process/runtime stats for the Metrics tab. Implementation:
`fetchDashboardMetrics()` — RSS and heap (MB), event-loop lag (ms), process uptime,
active SSE connections, and current agent count from the hub.

Poll interval is tab-driven (on Metrics tab activation), not on a fixed cron.

---

## Serve-probe and gate artifacts

Card cache server, artifact inspection routes, `[doctor.probe]` config, and Herdr tab
wiring are documented in [serve-probe.md](./serve-probe.md).

Quick reference:

```bash
kimi-doctor --serve-probe                    # HTTP cache (port from [doctor.probe] or env)
kimi-doctor --gate bunfig-policy --save-artifact
kimi-doctor --artifacts-list bunfig-policy
```

### Gate dependency and artifact lineage graphs

Two graph types — keep separate:

| Graph | Describes | CLI | Dashboard |
| ----- | ----------- | --- | --------- |
| **Execution DAG** | Gate run order (`dependsOn` orchestration) | `--gate-graph` / `--graph` | Lineage tab → Gate execution DAG (`GET /api/gates/graph`) |
| **Artifact lineage** | Data consumed by a saved artifact | `--artifacts-lineage`, `artifacts lineage <gate>`, `--artifact-graph` (Mermaid only) | Lineage tab → Artifact panel (`GET /api/artifacts/:gate/lineage`) |

```bash
# Execution order (orchestration)
kimi-doctor --gate perf-gate --gate-graph --json

# Run gate closure; runtime provenance lands in metadata.lineage
kimi-doctor --gate perf-gate --save-artifact

# Trace upstream artifacts (tree + Mermaid)
kimi-doctor --artifacts-lineage perf-gate --json
kimi-doctor artifacts lineage perf-gate --json

# Mermaid only (declarative dependsOn or runtime lineage)
kimi-doctor --artifact-graph model-drift
```

**Runtime lineage** (`metadata.lineage`) — injected by `runGatesWithDependencies()` after upstream gates complete; lists `dependencies` (gate names) and `upstreamArtifacts` (relative paths).

**Declarative lineage** (`metadata.dependsOn`) — author-declared at save time; resolves to concrete artifact paths; auto-generates `lineageMermaid`.

Agent context: gates receive `getArtifact`, `getArtifacts`, and `readArtifact` on `GateRunOptions` (populated by the runner). See `examples/artifact-dependency-graphs.md`.

ADR: [ADR-0004 serve-probe read-only](../adr/ADR-0004-serve-probe-readonly.md).

---

## Relationship to other endpoints

- **Serve-probe HTTP + artifacts** → [serve-probe.md](./serve-probe.md)
- **Dashboard storage / thumbnail architecture** → [dashboard-thumbnails.md](./dashboard-thumbnails.md)
- **`meta.webview` profile fields** → [dashboard-thumbnails.md](./dashboard-thumbnails.md#metawebview-object) (persistent vs ephemeral, directory, WebKit guard)
- **Orchestrator probe** (`herdr-orchestrator dashboard --probe`) → returns the
  lower-level `ready` / `agentRows` / `screenshotBytes` / … shape — not the same as
  the doctor gate.
- **Dashboard meta gate** → `kimi-doctor --dashboard-meta` (`GET /api/meta` discovery contract) — runtime gate, not in `[finishWork].gates`; invoked by Herdr orchestrator when a dashboard is live

---

## WebView profile / backend

The automation gate always uses an **ephemeral, headless** `Bun.WebView` on a
throwaway server. It does **not** expose `backend`, `profileDir`, or
`meta.webview` in its JSON output. For persistent-profile behaviour, query the
running dashboard's `/api/meta` endpoint (`kimi-doctor --dashboard-meta`).

---

## Finish-work integration

`dx.config.toml` `[finishWork].gates` includes `kimi-doctor --automation`.
Gate key: `dashboard-automation` (`src/lib/finish-work-herdr.ts`).

`--dashboard-meta` is intentionally **not** in `[finishWork].gates` — it probes a
live Herdr dashboard (needs `HERDR_DASHBOARD_URL`), so it belongs in the Herdr
orchestrator bootstrap / `doctor` tab cron, not in the toolchain close-loop.

Canonical manifest id: `kimi-doctor` in `canonical-references.json`.

**Canvas companion:** `docs/canvases/herdr-dashboard-automation.canvas.tsx` (manifest id `kimi-doctor` · `cursorCanvas` pointer; not synced).

---

## Boundary: `docs/references/` vs `src/lib/canonical-references.ts`

| Layer | Role | Example |
|-------|------|---------|
| `docs/references/*.md` | Human-readable API docs, long-form explanations, flag tables | `kimi-doctor.md`, `namespace.md`, `dashboard-thumbnails.md` |
| `src/lib/canonical-references.ts` | Machine-readable registry: manifest rows, ecosystem repos, canvas routing, doc-link lint gate | `CANVAS_ROUTING`, `ECOSYSTEM_REPOS`, `DOC_REFERENCES` |
| `canonical-references.json` | Generated manifest snapshot (cache at `~/.kimi-code/`) | `bun run references:generate` |

**Rule:** Add a `docs/references/*.md` doc → add a matching row in `canonical-references.ts` → run `bun run references:generate && bun run sync:verify`.

The `kimi-doctor --doc-links` lint gate enforces that every entry in `DOC_REFERENCES` has a corresponding `docs/references/*.md` file on disk and vice versa. This file (`kimi-doctor.md`) has its row in the `DOC_REFERENCES` array under the `kimi-doctor` namespace.

**Cross-references within `docs/references/`:**
- `namespace.md` — doctor trinity and Herdr plugin boundaries
- `dashboard-thumbnails.md` — screenshot → thumbnail pipeline
- `bun-runtime-scaffold.md` — Bun install config layers
- `herdr-socket-saturation-protocol.md` — EAGAIN recovery
- `configuration-layers.md` — where `thresholds.json` fits in the config model
- `serve-probe.md` — `--serve-probe`, `[doctor.probe]`, artifact list API
- `template-matrix.md` — domain effect module templates

## Effects pipeline (`perf-doctor` / scaffolded `doctor` module)

The **performance control loop** lives in `examples/dashboard/src/bin/perf-doctor.ts` and is scaffolded into new projects by default (`KIMI_MODULES=doctor` when unset). Main `kimi-doctor` runs diagnostics and effect-gates; **file-triggered perf watch** is `perf-doctor --watch`, not `kimi-doctor --watch` (which polls effect-gates every 5s).

### Primary commands (scaffolded projects)

```bash
bun run perf:gates              # perf-doctor --perf-gates
bun run perf:train              # train thresholds.json (actualMs × 1.1)
bun run perf:watch              # fs.watch src/harness + src/lib/isolation
bun run src/bin/perf-doctor.ts --report --out=.
```

Reference dashboard also documents aspirational `kimi-doctor --perf-gates` flags; production perf gates use **perf-doctor** until wired into main CLI.

### Effect discipline repair

```bash
kimi-heal --fix [--dry-run|--yes]              # auto-wrap bare promises, rewrite domain imports
kimi-heal effect audit --profile toolchain --fix
```

Profiles (`toolchain` | `minimal` | `ci`) select supplementary pipeline checks; see README § Effect Audit Profiles.

### The self-calibrating chain

```
Symbol contract (e.g. kimi.effect.image)
        ↓
MODULE_REGISTRY workloads (src/harness/module-registry.ts)
        ↓
Bun.nanoseconds() measurement per registry key
        ↓
perf-doctor --train → thresholds.json (actualMs × 1.1)
        ↓
perf-doctor --perf-gates enforces thresholds
        ↓
perf-report.html artifact
```

### `thresholds.json` shape

```json
{
  "Symbol(kimi.effect.image).metadata": 5.0,
  "Symbol(kimi.effect.image).placeholder": 50.0,
  "Symbol(kimi.effect.image).thumbnail": 200.0
}
```

Keys are `{symbol}.{operation}`; values are milliseconds. `--train` sets each threshold to `actualMs × 1.1` (10% margin). `--perf-gates` fails any operation whose `actualMs` exceeds its threshold.

### `perf-report.html`

Generated by `src/harness/html-reporter.ts` — a standalone HTML table with per-operation metrics (symbol, operation, actualMs, thresholdMs, pass/fail). Dark theme (`#0d1117`), system-ui font, collapsible sections.

### Related skill examples

| Example | Path | What it shows |
|---------|------|---------------|
| Platform absorption | `examples/platform-absorption.md` | How Bun substrate improvements tighten thresholds automatically |
| Image effect | `examples/image-effect.md` | First concrete domain effect — full scan → benchmark → train → report loop |

### Domain effect modules

Domain effect handlers live under `templates/modules/` for scaffolding and `examples/dashboard/src/effect/` for the reference dashboard:

| Effect | Module | Key Bun API |
|--------|--------|-------------|
| `kimi.effect.image` | `image/processor.ts` | `Bun.Image` |
| `kimi.effect.db` | `db/processor.ts` | `bun:sqlite` |
| `kimi.effect.uuid` | `uuid/processor.ts` | `Bun.randomUUIDv7` |
| `kimi.effect.terminal` | `terminal/processor.ts` | `Bun.Terminal` |
| `kimi.effect.http` | `http/processor.ts` | `fetch` with protocol pinning |

---

## Related source files

| Concern | File |
| ------- | ---- |
| CLI entry | `src/bin/kimi-doctor.ts` |
| Automation gate | `src/lib/herdr-dashboard-automation-gate.ts` |
| Automation runner | `src/lib/herdr-dashboard-automation.ts` |
| Live gate-health API + watch | `src/lib/herdr-dashboard-data.ts`, `src/lib/herdr-dashboard-gate-watch.ts` |
| Metrics API | `src/lib/herdr-dashboard-data.ts` (`fetchDashboardMetrics`) |
| WebP encode | `src/lib/bun-image.ts` (`dashboardWebpThumbnail`) |
| Doctor adapter | `src/lib/doctor-adapters/dashboard-automation.ts` |
| Serve-probe CLI / server | `src/lib/card-probe-cli.ts`, `src/lib/card-probe-server.ts` |
| Artifact store | `src/lib/artifact-store.ts` |
| `[doctor.probe]` config | `src/lib/doctor-probe-config.ts` |
| Perf gate | `src/guardian/perf-gate.ts` |
| HTML reporter | `src/harness/html-reporter.ts` |
| Perf monitor (harness) | `examples/dashboard/src/harness/perf-monitor.ts` |
| Image effect (reference) | `examples/dashboard/src/effect/image/processor.ts` |
| Image effect (template) | `templates/modules/image/src/processor.ts` |
| Symbols / registration | `examples/dashboard/src/lib/symbols.ts` |
