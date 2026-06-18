# Dashboard thumbnails and WebView profile

How the Herdr orchestrator dashboard turns a live `Bun.WebView` screenshot into a compressed thumbnail served by the dashboard HTTP server, and how that relates to the WebView's persistent `dataStore` profile.

## High-level flow

```
Bun.WebView (dashboard UI)
  │  screenshot({ format: "png" })
  ▼
Uint8Array PNG ──→ herdr-dashboard-automation.ts
  │  feedDashboardScreenshotPng() polls every 2s
  ▼
HerdrDashboardServerHandle.setScreenshotPng(png)
  │
  ├──→ /api/meta      exposes thumbnail capability + ThumbHash placeholder
  │
  └──→ /api/thumbnail reads PNG → Bun.Image.resize/encode → WebP/AVIF response
```

## Bun.Image pipeline

Source module: `src/lib/bun-image.ts`

- Input is always a PNG `Uint8Array` from `Bun.WebView.screenshot()`.
- Default thumbnail size is **320×180** (`fit: "inside"`, `withoutEnlargement: true`).
- Output formats: **WebP** (default), **AVIF**, **JPEG**, **PNG**.
- AVIF is negotiated from the HTTP `Accept` header on macOS/Windows; falls back to WebP with `ERR_IMAGE_FORMAT_UNSUPPORTED` on Linux or older Apple Silicon.
- ThumbHash LQIP is generated from the same PNG for the `/api/meta` `placeholder` field.
- Encoded thumbnails are cached in memory by a SHA-256 key over source bytes + dimensions + quality + format.

## WebView profile (`dataStore`)

Source modules: `src/lib/herdr-dashboard-webview-store.ts`, `src/lib/herdr-webview-dashboard.ts`

`Bun.WebView` accepts a `dataStore` option:

- `"ephemeral"` (default) — cookies, localStorage, and session state are discarded when the WebView closes.
- `{ directory }` — persistent profile directory on disk.

The dashboard CLI resolves persistence from `dx.config.toml`:

```toml
[herdr.orchestrator.dashboard]
stale_ms = 15000
sse_poll_ms = 5000
poll_hint_ms = 5000
persist_profile = true           # uses default ~/.kimi-code/var/herdr-orchestrator-dashboard-webview
# profile_dir = "/custom/path"   # optional override
```

**Important:** the `dataStore` directory holds browser state only (WebKit/Chrome profile data). It does **not** hold dashboard screenshots or thumbnails. Thumbnails live in an in-memory TTL cache on the dashboard server.

## `/api/meta` fields

Source module: `src/lib/herdr-dashboard-server.ts`

| Field | Meaning |
| ------ | ------- |
| `webview` | Resolved WebView profile block — see table below |
| `thumbnail` | `true` when a screenshot feed or cached PNG can satisfy `/api/thumbnail`. |
| `thumbnailPath` | Always `"/api/thumbnail"` when thumbnail support is compiled in. |
| `thumbnailFormats` | `{ webp: true, avif: <runtime-probed> }`. |
| `placeholder` | ThumbHash data URL of the current screenshot (LQIP). |

### `meta.webview` object

Built by `buildDashboardMetaWebView()` in `src/lib/herdr-dashboard-webview-store.ts`. Surfaced on every `GET /api/meta` response and rendered in the dashboard status line (`formatWebViewLine` in `templates/herdr-dashboard.js`).

| Field | Meaning |
| ------ | ------- |
| `shell` | How the server was launched: `serve` (headless HTTP), `webview`, or `automation` |
| `mode` | `ephemeral` or `persistent` — resolved `dataStore` mode |
| `persistProfile` | Whether `persist_profile` / `--persist-profile` was requested in config or CLI |
| `profileDir` | Explicit `profile_dir` or `--profile-dir` override, when set |
| `directory` | Active persistent profile path when `mode === "persistent"` |
| `defaultProfileDir` | Default path: `~/.kimi-code/var/herdr-orchestrator-dashboard-webview` |
| `defaultStoreName` | Folder name under `var/` (`herdr-orchestrator-dashboard-webview`) |
| `backend` | WebView engine label: `webkit` or `chrome` |

**Config sources** (precedence: CLI flags → `dx.config.toml` `[herdr.orchestrator.dashboard]` → env):

- `persist_profile` / `--persist-profile` → persistent `dataStore`
- `profile_dir` / `--profile-dir` → custom directory
- `HERDR_DASHBOARD_WEBVIEW_STORE` env → overrides default persist directory

**WebKit guard:** on macOS 15.2 + WebKit, persistence may be downgraded to ephemeral even when `persistProfile` is true. The UI shows `persist configured — WebKit guard may force ephemeral` when that happens.

**Relation to thumbnails:** `meta.webview` describes browser profile storage only. Thumbnail availability is a separate concern — check `meta.thumbnail` and `meta.thumbnailPath`. A persistent profile does not imply thumbnails are available; conversely, thumbnails can be served in ephemeral mode when a screenshot feed is active.

See also: `CODE_REFERENCES.md` § Dashboard profile persistence, `docs/table-herdr-orchestrator-dashboard.md`.

## `/api/thumbnail` behavior

- Returns **503** when `Bun.Image` is unavailable.
- Returns **404** when no screenshot has been captured and no `screenshotProvider` is injected.
- Query params: `width`, `height`, `quality`, `format`.
- Format negotiation order: explicit `format` query → `Accept: image/avif` → WebP.
- Response headers include `x-thumbnail-cache: hit|miss`.

## Frontend consumption

Source module: `templates/herdr-dashboard.js`

- On meta refresh, checks `data.thumbnail` and `data.thumbnailPath`.
- If `data.placeholder` exists, shows the blur preview first (`class="lqip"`).
- Loads the full thumbnail at `160×90` quality 75 with a cache-busting timestamp.
- Hides the thumbnail panel when the server reports no feed.

## When thumbnails are available

Thumbnails are served when any of these is true:

- The dashboard is running inside `Bun.WebView` (`shell === "webview"` or `"automation"`) and `feedDashboardScreenshotPng` is active.
- A `screenshotProvider` callback was injected into `startHerdrDashboardServer`.
- A PNG has been explicitly cached via `setScreenshotPng`.

The `serve` shell (headless HTTP server only) has no screenshot feed unless a provider is injected.

## Platform notes

- `Bun.Image` is required; without it the thumbnail endpoints report unavailable.
- AVIF encode requires system codecs: macOS (ImageIO, M3+ for encode) or Windows (WIC + HEIF/AV1 extensions). Linux always falls back to WebP.
- For deterministic/golden-image tests, force `Bun.Image.backend = "bun"` (Highway SIMD) so geometry output is byte-identical across platforms. See `src/lib/bun-image.ts` helpers `setBunImageBackend` / `resetBunImageBackend`.

## Canonical Bun documentation

- `Bun.Image` pipeline — https://bun.com/docs/runtime/image
- `Bun.WebView` constructor + `dataStore` — https://bun.com/docs/runtime/webview
- `Bun.WebView.screenshot()` — https://bun.com/docs/runtime/webview#screenshots
- `Bun.serve` — https://bun.com/docs/api/http

## Related files

| Concern | File |
| ------- | ---- |
| Bun.Image helpers / thumbnail encode | `src/lib/bun-image.ts` |
| Dashboard HTTP server + `/api/meta` + `/api/thumbnail` | `src/lib/herdr-dashboard-server.ts` |
| WebView screenshot polling | `src/lib/herdr-dashboard-automation.ts` |
| WebView profile / `dataStore` resolution | `src/lib/herdr-dashboard-webview-store.ts` |
| WebView shell orchestration | `src/lib/herdr-webview-dashboard.ts` |
| Dashboard config parser | `src/lib/herdr-orchestrator-config.ts` |
| Frontend thumbnail display | `templates/herdr-dashboard.js` |
| Config table | `docs/table-herdr-orchestrator-dashboard.md` |
| Canonical link manifest | `canonical-references.json` (`id: dashboard-thumbnails`) |
