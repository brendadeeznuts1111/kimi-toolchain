# Project skills

Kimi Code loads skills from:

| Location | Scope |
| -------- | ----- |
| `.kimi-code/skills/<name>/SKILL.md` | Project-local (optional) |
| `~/.kimi-code/skills/` | Synced from `kimi-toolchain` (`bun run sync`) |
| `~/.agents/skills/` | User-wide agent skills |

See `UNIFIED.md` for Kimi Code vs toolchain boundaries.

## Bundled toolchain skills (synced)

| Skill | Layer | When to load |
| ----- | ----- | ------------ |
| `kimi-toolchain` | L1 | Project health, gates, scaffold, `kimi-doctor`, `kimi-fix`, sync |
| `create-template` | L2 | Authoring `templates/scaffold/` or `templates/bun-create/`; run `check:template-policy` after edits |
| `cloudflare-access` | L2 | Access tokens, `.cloudflare-access.yml`, service token hygiene |
| `effect-discipline` | L2 | `runCliExit`, effect-gates, typed CLI boundaries |
| `effect-hardening` | L3 | Effect services, layers, event streams |
| `herdr` | L2 | Herdr workspace/socket control (`HERDR_ENV=1`) |
| `orchestrator` | L3 | Cross-pane handoffs, watch-events (`HERDR_ENV=1`) |
| `finish-work` | L2 | Close-loop commit/push with gates (`HERDR_ENV=1`) |

List live catalog: `bun run skills:table` (from toolchain repo).

## Template + secrets quick refs

- **bun create:** postinstall must not call `bun init` — use `kimi-fix` for hardened scaffold.
- **kimi-new:** `bun init -m -y` then `kimi-fix` (bridge pattern).
- **Secrets:** prefer `Bun.secrets`; `.env.example` only — never commit `.env`.
- **Gate:** `bun run check:template-policy` after template changes.

Authoring runbook: `skills/create-template/SKILL.md` (repo) or `~/.kimi-code/skills/create-template/SKILL.md` (synced).