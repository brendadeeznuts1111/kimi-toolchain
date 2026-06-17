---
name: kimi-toolchain
description: |
  Teaches agents to operate kimi-toolchain CLI and align with Kimi Code docs.
  Use for kimi-doctor, kimi-governance, kimi-guardian, kimi-fix, kimi-heal,
  kimi-decision, or project health.
  For Kimi Code config/MCP/sessions use `kimi` and `kimi doctor` (official).
whenToUse: |
  Project health, R-Score, lockfile security, scaffolding, failure healing,
  decision rationale, or Bun quality gates.
  Kimi Code slash commands (/mcp, /goal) and ACP are separate from toolchain CLIs.
---

# kimi-toolchain

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

### Project Health Check

```
0. kimi-toolchain workspace verify  → if cursor slug blocker: reopen ~/kimi-toolchain; kimi-toolchain doctor --fix --fix-cursor
1. kimi doctor
2. kimi-toolchain doctor --ecosystem --quick
3. kimi-heal plan --json
4. kimi-governance score --preflight --quick
5. IF lockfile warn → kimi-guardian check
6. IF coverage gap → bun run test:coverage:fast (or test:coverage:ci)
7. IF governance gap → kimi-governance fix
8. kimi-memory trends
9. PRESENT state + trend + next action
```

### Dependency Changes

```
1. kimi-guardian check (mandatory)
2. IF hash mismatch → block push; ask before kimi-guardian sign
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
1. kimi-new <name>  OR  mkdir + bun init + kimi-fix .
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
- **Skills sync:** `bun run sync` → `~/.kimi-code/skills/` + `~/.agents/skills/` (`kimi-toolchain`, `cloudflare-access`, `herdr`)

## Related

- Cached link manifest: `~/.kimi-code/canonical-references.json` (`bun run references:generate`)
- Repo: https://github.com/brendadeeznuts1111/kimi-toolchain
- [CODE_REFERENCES.md](~/.kimi-code/CODE_REFERENCES.md) — local coding exemplars + ecosystem link table
- Kimi docs: https://moonshotai.github.io/kimi-code/
