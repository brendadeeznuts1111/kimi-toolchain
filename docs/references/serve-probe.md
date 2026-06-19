# kimi-doctor serve-probe — card cache + artifact inspection

Lightweight HTTP server for **live dashboard card health** and **read-only inspection** of saved gate artifacts under `.kimi/artifacts/`.

Gate execution stays CLI-bound. See [ADR 0004](../adr/ADR-0004-serve-probe-readonly.md).

## Primary command

```bash
kimi-doctor --serve-probe
```

Optional flags:

| Flag                    | Effect                                                                   |
| ----------------------- | ------------------------------------------------------------------------ |
| `--save-artifact`       | Persist each card refresh under `.kimi/artifacts/card-probe/`            |
| `--project-root <path>` | Artifact store root (default: `process.cwd()`)                           |
| `--probe-cards`         | With `--serve-probe`, warm cache once then exit (`serve-probe-once`)     |
| `--strict-probe`        | Exit 1 when any card is not `pass` (one-shot modes only)                 |
| `--json`                | Emit structured payload before blocking (long-running mode still blocks) |

Package script (toolchain scaffold): `bun run doctor:probe:serve`.

## Configuration (`dx.config.toml`)

Toolchain scaffold (`templates/scaffold/dx.config.toolchain.toml`):

```toml
[doctor]
gates = ["bunfig-policy"]
tabs = [
  { name = "probe", command = "kimi-doctor --serve-probe" },
  { name = "bunfig", command = "kimi-doctor --gate bunfig-policy" },
]

[doctor.probe]
port = 5678
interval = 15000
```

| Field                     | Purpose                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------- |
| `[doctor].tabs`           | Inline array of `{ name, command }` doctor panes (legacy `[[doctor.tabs]]` with `label` still parses) |
| `[doctor.probe].port`     | Bind port (scaffold default **5678**)                                                                 |
| `[doctor.probe].interval` | Periodic card refresh interval in ms (default scaffold **15000**)                                     |
| `[doctor.probe].host`     | Bind host (optional)                                                                                  |

**Precedence:** `PROBE_SERVER_PORT` / `PROBE_SERVER_HOST` env vars override TOML. When neither is set, runtime falls back to **5678** on `127.0.0.1` (`DEFAULT_PROBE_SERVER_PORT`, aligned with Dashboard Contract v1.0).

Parser: `readDoctorConfig()` / `readDoctorProbeConfig()` in `src/lib/doctor-probe-config.ts`.

## Herdr workspace tabs

`[[herdr.tabs]]` is separate from `[doctor].tabs`. The scaffold probe Herdr tab may add `--save-artifact --project-root .` for workspace artifact persistence while the `[doctor]` tab stays minimal.

## HTTP routes

Implementation: `src/lib/card-probe-server.ts` (`startProbeServer`).

| Method         | Path                           | Behavior                                                       |
| -------------- | ------------------------------ | -------------------------------------------------------------- |
| `GET` / `HEAD` | `/api/health`                  | Liveness (`ok` text)                                           |
| `GET`          | `/api/cards`                   | Cached card probe snapshot                                     |
| `GET` / `POST` | `/api/refresh`                 | Re-probe cards; optional `artifactPath` when `--save-artifact` |
| `GET`          | `/api/artifacts`               | List gate names with saved artifacts                           |
| `GET`          | `/api/artifacts/:gate`         | List artifacts; query `?limit=N&since=ISO-8601`                |
| `GET`          | `/api/artifacts/:gate/latest`  | Newest artifact payload (unwrapped)                            |
| `POST`         | `/api/artifacts/:gate/refresh` | **403** — read-only (ADR-0004)                                 |

### Artifact list entry shape

`GET /api/artifacts/:gate` returns `files[]` with sizes from envelope JSON (no `stat()`):

```json
{
  "path": ".kimi/artifacts/card-probe/2026-06-19T12-00-00-000Z.json",
  "timestamp": "2026-06-19T12:00:00.000Z",
  "size": 1234,
  "resultSize": 456
}
```

- `size` — full envelope file bytes
- `resultSize` — serialized `payload` bytes (`metadata.resultSize` at save time)

Save envelope also records `metadata.hostname`, `metadata.pid`, `metadata.bunVersion`.

## Gate artifacts (CLI)

Artifacts are written only with explicit `--save-artifact`:

```bash
kimi-doctor --gate bunfig-policy --save-artifact   # runs dependsOn closure when present
kimi-doctor --run-gates --save-artifact            # all built-in gates in topo order
kimi-doctor --serve-probe --save-artifact          # card-probe gate only
```

Store: `ArtifactStore` in `src/lib/artifact-store.ts` → `.kimi/artifacts/{gateName}/`.

CLI inspection:

```bash
kimi-doctor --artifacts-list bunfig-policy
kimi-doctor --artifacts-latest card-probe --json
```

## Dashboard integration

The Herdr dashboard (`:18412`) proxies serve-probe for live card health and enriches the Artifacts tab from disk.

| Dashboard route        | Behavior                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `GET /api/health`      | Includes `checks.probe` (pass/fail/unknown from serve-probe `/api/cards`)                |
| `GET /api/probe/cards` | Proxy to serve-probe card snapshot                                                       |
| `GET /api/artifacts`   | Disk-backed gate inventory + `latestSize` / `latestResultSize` + probe reachability hint |
| `GET /api/meta`        | Exposes `probeServerUrl` from `[doctor.probe]`                                           |

| Surface             | Port                                  | Artifact source                                                |
| ------------------- | ------------------------------------- | -------------------------------------------------------------- |
| **serve-probe**     | `[doctor.probe].port` (5678 scaffold) | `ArtifactStore` + live `/api/cards`                            |
| **Herdr dashboard** | 18412 (`HERDR_DASHBOARD_URL`)         | Artifacts tab reads disk; Probe summary card polls serve-probe |

Both observe the same files when `projectRoot` matches and `--save-artifact` has run.

## Environment variables

See `templates/scaffold/env.example`:

```bash
# EXAMPLES_DASHBOARD_URL=http://127.0.0.1:5678
# HERDR_DASHBOARD_URL=http://127.0.0.1:18412
# PROBE_SERVER_HOST=127.0.0.1
# PROBE_SERVER_PORT=5678   # overrides [doctor.probe].port when set
```

Card auto-discovery probes the canonical examples port `5678` first, then legacy fallback ports `3000` and `8080`; Herdr is probed on `18412`.

## Related source files

| Concern                         | File                                                          |
| ------------------------------- | ------------------------------------------------------------- |
| CLI orchestration               | `src/lib/card-probe-cli.ts`                                   |
| HTTP server                     | `src/lib/card-probe-server.ts`                                |
| dx.config parser                | `src/lib/doctor-probe-config.ts`                              |
| Artifact persistence            | `src/lib/artifact-store.ts`                                   |
| Gate runner + `--save-artifact` | `src/gates/runner.ts`, `src/bin/kimi-doctor.ts`               |
| Capability manifest             | `src/lib/doctor-probe.ts` (`--probe` / `--serve-probe` flags) |
| ADR                             | `docs/adr/ADR-0004-serve-probe-readonly.md`                   |
