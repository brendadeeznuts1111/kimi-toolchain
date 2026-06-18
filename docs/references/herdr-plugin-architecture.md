# Herdr unified plugin architecture (v0.5.0)

Thin hub for the Herdr unified plugin plan — **orthogonal** to kimi-toolchain finish-work shell gates.

Manifest id: `herdr-plugin-architecture` · repo: `docs/references/herdr-plugin-architecture.md` · runtime: `~/.kimi-code/docs/references/herdr-plugin-architecture.md` · canvas: `docs/canvases/herdr-unified-plugin-architecture.canvas.tsx` (IDE pointer via `cursorCanvas`; not synced)

## Scope

| Layer | Examples | Config |
| ----- | -------- | ------ |
| Finish-work shell gates | `kimi-doctor --automation`, `kimi-heal effect audit` | `dx.config.toml` `[finishWork].gates` |
| Herdr plugin actions | `herdr-orchestrator.agent-start`, `herdr-doctor.status` | `~/.config/herdr/config.toml` `[[keys.command]]` |
| Orchestrator HTTP | `GET /api/meta`, `GET /api/thumbnail` | Co-located `Bun.serve` — see [dashboard-thumbnails.md](./dashboard-thumbnails.md) |

**Rule:** `prefix+*` in Herdr invokes **plugin handlers**, not `kimi-doctor` from PATH.

## Plugin topology (v0.5.0)

| Plugin | Role | Keybindings (examples) |
| ------ | ---- | ---------------------- |
| `herdr-orchestrator` | Remote agents, audit, GitHub link previews, fleet dashboard | `prefix+a/l/f/t` |
| `herdr-doctor` | Sidebar fleet/manifest status | `prefix+d` |
| `herdr-notify` | Slack/Discord webhooks on agent events | Event hooks only |

State: `HERDR_PLUGIN_STATE_DIR` · config: `~/.config/herdr/config.toml` · no back-edges in plugin DAG.

## Orthogonal to finish-work

| Concern | Status |
| ------- | ------ |
| `kimi-doctor --automation` | Self-contained — no plugin link, SSH, or `notify.json` |
| `[finishWork].gates` | In-repo: `check:fast`, `--effect-gates`, `--automation`, `kimi-heal effect audit` |
| Effect-TS boundary | Herdr plugins are L1/L2 Bun-native; Effect enforcement stays in `kimi-doctor` / `kimi-heal` |

Open plugin-plan gaps (scaffold, manifests, plugin link, notify config, keybindings, SSH, GitHub topic) are **not blockers** for `--automation` or finish-work.

## Related

| Topic | Path |
| ----- | ---- |
| Name collisions (doctor trinity, prefix+*) | [namespace.md](./namespace.md) |
| Automation gate CLI + JSON | [kimi-doctor.md](./kimi-doctor.md) |
| Thumbnail pipeline | [dashboard-thumbnails.md](./dashboard-thumbnails.md) |
| Finish-work close-loop | [../../docs/finish-work-close-loop.md](../../docs/finish-work-close-loop.md) |
| Visual companion | `docs/canvases/herdr-unified-plugin-architecture.canvas.tsx` |
