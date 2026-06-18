# kimi-doctor dashboard-automation gate

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
  `dashboardWebpThumbnail` pipeline returns `image/webp`
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

## Relationship to other endpoints

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

## Related source files

| Concern | File |
| ------- | ---- |
| CLI entry | `src/bin/kimi-doctor.ts` |
| Automation gate | `src/lib/herdr-dashboard-automation-gate.ts` |
| Automation runner | `src/lib/herdr-dashboard-automation.ts` |
| WebP encode | `src/lib/bun-image.ts` (`dashboardWebpThumbnail`) |
| Doctor adapter | `src/lib/doctor-adapters/dashboard-automation.ts` |
