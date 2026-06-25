# Project skills

Kimi Code loads skills from:

| Location                            | Scope                                         |
| ----------------------------------- | --------------------------------------------- |
| `.kimi-code/skills/<name>/SKILL.md` | Project-local (optional)                      |
| `~/.kimi-code/skills/`              | Synced from `kimi-toolchain` (`bun run sync`) |
| `~/.agents/skills/`                 | User-wide agent skills                        |

See `UNIFIED.md` for Kimi Code vs toolchain boundaries.

## Bundled toolchain skills (synced)

| Skill               | Layer | Code modules (lib)                                      | When to load                                                                                        |
| ------------------- | ----- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `kimi-toolchain`    | L1    | `tool-runner.ts`, `kimi-doctor.ts`                      | Project health, gates, scaffold, `kimi-doctor`, `kimi-fix`, sync                                    |
| `create-template`   | L2    | `scaffold-templates.ts`, `template-policy-audit.ts`     | Authoring `templates/scaffold/` or `templates/bun-create/`; run `check:template-policy` after edits |
| `cloudflare-access` | L2    | `cloudflare-access.ts`, `cloudflare-access-policy.ts`   | Access tokens, `.cloudflare-access.yml`, service token hygiene                                      |
| `effect-discipline` | L2    | `effect-gates.ts`, `cli-runtime.ts`                     | `runCliExit`, effect-gates, typed CLI boundaries                                                    |
| `effect-hardening`  | L3    | `effect-gates.ts`, `tool-runner-effect.ts`              | Effect services, layers, event streams                                                              |
| `herdr`             | L2    | `herdr-orchestrator.ts`, `herdr-orchestrator-events.ts` | Herdr workspace/socket control (`HERDR_ENV=1`)                                                      |
| `orchestrator`      | L3    | `herdr-orchestrator.ts`, `herdr-orchestrator-events.ts` | Cross-pane handoffs, watch-events (`HERDR_ENV=1`)                                                   |
| `finish-work`       | L2    | `finish-work-herdr.ts`, `finish-work-config.ts`         | Close-loop commit/push with gates (`HERDR_ENV=1`)                                                   |

List live catalog: `bun run skills:table` · module map: `bun run skills:table --verbose` · JSON: `bun run skills:table --json`.

## Template + secrets quick refs

- **bun create:** postinstall must not call `bun init` — use `kimi-fix` for hardened scaffold.
- **kimi-new:** `bun init -m -y` then `kimi-fix` (bridge pattern).
- **Secrets:** prefer `Bun.secrets`; `.env.example` only — never commit `.env`.
- **Gate:** `bun run check:template-policy` after template changes.

Authoring runbook: `skills/create-template/SKILL.md` (repo) or `~/.kimi-code/skills/create-template/SKILL.md` (synced).
