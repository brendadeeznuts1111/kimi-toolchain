---
name: kimi-toolchain
description: |
  Teaches agents to operate kimi-toolchain CLI and align with Kimi Code docs.
  Use for kimi-doctor, kimi-governance, kimi-guardian, kimi-fix, kimi-heal,
  kimi-decision, or project health.
  For Kimi Code config/MCP/sessions use `kimi` and `kimi doctor` (official).
whenToUse: |
  Project health, R-Score, lockfile security, scaffolding, failure healing,
  decision rationale, Bun quality gates, cross-tool health telemetry.
  Kimi Code slash commands (/mcp, /goal) and ACP are separate from toolchain CLIs.
layer: L1
trigger:
  - kimi-doctor or project health check
  - bun run check or pre-push gates
  - governance score or guardian
  - scaffold (bun create kimi-toolchain, kimi-new, kimi-fix)
  - sync runtime assets
  - cross-tool health events (kimi-resource-governor health-listen)
dependencies: []
loaded_by: System / On-demand
role: Toolchain meta-runbook — CLI routing, gates, Kimi vs toolchain split
token_estimate: 760
run_as: inline
metadata:
  companionSkills:
    - create-template
    - effect-discipline
    - effect-hardening
    - herdr
---

# Kimi-Toolchain (L1)

## Kimi Code vs toolchain

| Need                                | Use                                                   |
| ----------------------------------- | ----------------------------------------------------- |
| Kimi config, OAuth, models          | `kimi doctor` (official)                              |
| MCP servers, `/mcp-config`          | `kimi` TUI or edit `~/.kimi-code/mcp.json`            |
| Sessions, goals, subagents          | `kimi` / `kimi --continue` / `kimi --session`         |
| Zed/JetBrains agent                 | `kimi acp` (absolute path to `~/.kimi-code/bin/kimi`) |
| R-Score, guardian, hooks, Bun gates | `kimi-doctor`, `kimi-governance`, `bun run check`     |

**`kimi doctor` (Moonshot) ≠ `kimi-doctor` (toolchain).** Run both after toolchain changes.

Full product matrix: `~/.kimi-code/UNIFIED.md`. Toolchain agent guide: `~/.kimi-code/AGENTS.md`.

## Kimi Code CLI (official)

Docs: https://moonshotai.github.io/kimi-code/en/reference/kimi-command.html

| Flag                           | Short | Notes                                                     |
| ------------------------------ | ----- | --------------------------------------------------------- |
| `--continue`                   | `-C`  | Resume most recent session in cwd                         |
| `--session [id]`               | `-S`  | Resume specific session                                   |
| `--model <alias>`              | `-m`  | One-shot model override                                   |
| `--prompt <text>`              | `-p`  | Non-interactive stdout mode                               |
| `--yolo` / `--auto` / `--plan` |       | Permission / exploration modes — see official config docs |
| `--skills-dir <dir>`           |       | Replace auto-discovered skills                            |

**Conflicts (startup error):** `--continue`+`--session`, `--yolo`+`--auto`, `--plan`+resume flags, `--prompt`+permission flags.

| Slash                     | Purpose                   |
| ------------------------- | ------------------------- |
| `/mcp`                    | MCP connection status     |
| `/mcp-config`             | Interactive MCP editor    |
| `/goal next <text>`       | Queue multi-turn goal     |
| `/reload` / `/reload-tui` | Reload config or TUI only |

| Subcommand                                            | Purpose                           |
| ----------------------------------------------------- | --------------------------------- |
| `kimi login`                                          | OAuth device flow                 |
| `kimi doctor [config\|tui] [path]`                    | Validate config files             |
| `kimi acp`                                            | IDE Agent Client Protocol (stdio) |
| `kimi export [id]`                                    | Session ZIP export                |
| `kimi migrate` / `kimi upgrade`                       | Legacy data / version check       |
| `kimi provider list` / `catalog list` / `catalog add` | Provider management               |

Built-in subagents: `coder`, `explore`, `plan`. Env overrides: `KIMI_MODEL_*` (non-persistent), `KIMI_CODE_BACKGROUND_KEEP_ALIVE_ON_EXIT`, `KIMI_CODE_EXPERIMENTAL_SUB_SKILL`.

## Decision Protocol

Invoke when: project health, `package.json`/`bun.lock`/`bunfig.toml` edits, failures/loops, or scaffold requests.

Effect code or a new CLI using `runCliExit` → load **effect-discipline** (`skills/effect-discipline/SKILL.md`) first; L3 service/stream scaffolds → **effect-hardening** (`skills/effect-hardening/SKILL.md`).

### Project Health Check

```
0. bun run config:status  → after clone or when touching bunfig.toml, constants-parity.toml,
   or manifest-related files; must pass before other checks
1. kimi-toolchain workspace verify  → if cursor slug blocker: reopen ~/kimi-toolchain; kimi-toolchain doctor --fix --fix-cursor
2. kimi doctor
3. kimi-toolchain doctor --ecosystem --quick
4. kimi-heal plan --json
5. kimi-governance score --preflight --quick
6. IF lockfile warn → kimi-guardian check
7. IF coverage gap → bun run test:coverage:fast (or test:coverage:ci)
8. IF governance gap → kimi-governance fix
9. kimi-memory trends
10. PRESENT state + trend + next action
```

### Dependency Changes

```
1. kimi-guardian check (mandatory)
2. IF hash mismatch → block push; ask before kimi-guardian fix (hash baseline); use kimi-guardian sign only for v2 signed manifest protection
3. IF pass → continue
```

### Failure Recovery

```
1. kimi-debug last
2. kimi-debug wire          # auto-discovers latest session
3. ~/.kimi-code/var/tool-failures.jsonl
4. kimi-heal clusters --json && kimi-heal plan --json
5. kimi-decision audit --json
6. kimi-memory trends
7. IF CONTEXT stale → kimi-context-gen freshness / update
8. PRESENT timeline + taxonomyId + heal plan steps
```

Taxonomy lookup: `kimi-debug analyze --json` or `kimi-debug classify <text>` (`~/.kimi-code/error-taxonomy.yml`).

### Scaffold New Project

```
1. bun create kimi-toolchain <name>  OR  kimi-new <name>  OR  mkdir + bun init + kimi-fix .
2. kimi-fix doctor .
3. kimi-governance score (target ≥ C)
4. kimi login
5. Customize AGENTS.md one-liner, CODE_REFERENCES.md, CODEOWNERS
```

### Before Commit or Push

```
1. kimi-githooks doctor
2. bun run check:fast (iterate); bun run check (before push)
3. kimi-guardian check
4. IF runtime assets changed → bun run sync && bun run sync:verify
5. kimi-governance score --preflight --quick  (pre-push blocks D/F)
```

## R-Score

Points out of 110; grades A≥90%, B≥80%, C≥70%, D≥60%, F<60%. Preflight auto-fix: `kimi-governance score --preflight`. Details: [AGENTS.md](~/.kimi-code/AGENTS.md) § R-Score.

## Security Boundaries

- Never suggest `git push --no-verify`
- Never ignore `kimi-guardian` failures
- Never use YOLO (`-y`) with untrusted MCP shell tools
- Never hand-edit `~/.kimi-code/sessions/` or `credentials/`
- Prefer `Bun.secrets` over `.env` files

## Runtime & MCP

- **Memory:** `~/.kimi-code/var/sessions.db` (not Kimi `sessions/wd_*`) — `kimi-memory trends|recall|search`
- **MCP:** `unified-shell` auto-registered in `~/.kimi-code/mcp.json` on `bun run sync`; verify with `kimi-doctor --quick` or `/mcp`
- **Hooks:** Git (`kimi-githooks`), Bun postinstall, Kimi lifecycle (`kimi-hooks/`) — see [AGENTS.md](~/.kimi-code/AGENTS.md) § Hooks taxonomy
- **Paths:** `src/lib/paths.ts` helpers; layout in [UNIFIED.md](~/.kimi-code/UNIFIED.md)
- **Skills sync:** `bun run sync` → `~/.kimi-code/skills/` + `~/.agents/skills/` (`kimi-toolchain`, `cloudflare-access`, `effect-discipline`, `effect-hardening`, `herdr`)
- **Health channel:** `~/.kimi-code/var/health-events.jsonl` — cross-tool telemetry. `kimi-doctor` publishes, `kimi-resource-governor health-listen` subscribes. See `src/lib/health-channel.ts`.

## Related

### Configuration layers & audit

- **Hub doc**: `~/.kimi-code/docs/references/configuration-layers.md` (manifest id `configuration-layers`) — explains the four-layer model.
- **Bun runtime scaffold**: `~/.kimi-code/docs/references/bun-runtime-scaffold.md` (manifest id `bun-runtime-scaffold`) — Bun install config, global virtual store, `process.execve()`, `Bun.Terminal` on Windows, `using`/`await using`.
- **One-shot audit**: `bun run config:status` — checks freshness of `canonical-references.json`, `constants-manifest.json`, parity alignment, and scaffold integrity (step 0 in Project Health Check).
- **Canvas companions** (repo pointers via `cursorCanvas`; not synced to runtime):
  - `docs/canvases/kimi-toolchain.canvas.tsx` — project hub (manifest id `unified`)
  - `docs/canvases/kimi-fix.canvas.tsx` — scaffold · bun create · profiles (manifest id `templates`)
  - `docs/canvases/namespace-boundaries.canvas.tsx` — doctor trinity and binding layers (manifest id `namespace`)
  - `docs/canvases/configuration-layers.canvas.tsx` — four-layer config model (manifest id `configuration-layers`)
- **Canvas lint**: `bun run scripts/lint-cursor-canvas.ts` — verifies each `cursorCanvas` path exists under `docs/canvases/`.

- Cached link manifest: `~/.kimi-code/canonical-references.json` (`bun run references:generate`)
- Repo: https://github.com/brendadeeznuts1111/kimi-toolchain
- [CODE_REFERENCES.md](~/.kimi-code/CODE_REFERENCES.md) — local coding exemplars + ecosystem link table
- **Inline doc routing (`@see`)**: [namespace.md § Practical @see ladder](~/.kimi-code/docs/references/namespace.md#practical-see-ladder) — `@see dx` · `@see namespace-boundaries` (name collision resolver + canvas) · lowest rung first; Bun URLs in `src/` via `bun run lint:doc-links`
- Kimi docs: https://moonshotai.github.io/kimi-code/
