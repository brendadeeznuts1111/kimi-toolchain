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

## Kimi Code CLI flags

| Flag                    | Short | Description                                                  |
| ----------------------- | ----- | ------------------------------------------------------------ |
| `--continue`            | `-C`  | Resume most recent session in current cwd                    |
| `--session [id]`        | `-S`  | Resume specific session (or open selector)                   |
| `--model <alias>`       | `-m`  | Override `default_model` for this launch                     |
| `--prompt <text>`       | `-p`  | Single-prompt non-interactive mode (stdout)                  |
| `--output-format <fmt>` |       | `text` or `stream-json`; only with `--prompt`                |
| `--yolo`                | `-y`  | Auto-approve regular tool calls (skips prompts)              |
| `--auto`                |       | Auto permission mode; Agent handles everything               |
| `--plan`                |       | Start in Plan mode (read-only exploration first)             |
| `--skills-dir <dir>`    |       | Load Skills from custom directory (replaces auto-discovered) |

**Flag conflicts (rejected at startup):** `--continue` + `--session`, `--yolo` + `--auto`, `--plan` + `--continue`/`--session`, `--prompt` + `--yolo`/`--auto`/`--plan`.

**Permission modes:** `--yolo` (flag) skips approval for regular tools but still asks for plan exit. `default_permission_mode = "yolo"` (config) is persistent. `--auto` (flag) is non-interactive for this session only.

## Kimi Code slash commands

| Command                 | Purpose                                    |
| ----------------------- | ------------------------------------------ |
| `/mcp`                  | MCP server connection status               |
| `/mcp-config`           | Add/edit MCP servers interactively         |
| `/goal next <text>`     | Queue a multi-turn goal                    |
| `/reload`               | Reload session after config edits          |
| `/reload-tui`           | Reload TUI preferences only                |
| `/swarm`                | Agent swarms (0.12.0+)                     |
| `/import-from-cc-codex` | Import Cursor/Codex skills + MCP (0.13.0+) |

## Kimi Code subcommands

| Subcommand                       | Purpose                                  | Example                                                |
| -------------------------------- | ---------------------------------------- | ------------------------------------------------------ |
| `kimi login`                     | OAuth device-code flow (non-interactive) | `kimi login`                                           |
| `kimi doctor`                    | Validate `config.toml` + `tui.toml`      | `kimi doctor config` (validate only config)            |
| `kimi doctor config [path]`      | Validate only `config.toml`              | `kimi doctor config ./config.toml`                     |
| `kimi doctor tui [path]`         | Validate only `tui.toml`                 | `kimi doctor tui ./tui.toml`                           |
| `kimi acp`                       | ACP IDE mode (JSON-RPC over stdio)       | Started by IDE, not manually                           |
| `kimi export [id]`               | Export session to ZIP                    | `kimi export -y` (latest session, skip confirm)        |
| `kimi migrate`                   | Migrate legacy `~/.kimi` data            | `kimi migrate`                                         |
| `kimi upgrade`                   | Check for updates                        | `kimi upgrade`                                         |
| `kimi provider list`             | List configured providers                | `kimi provider list --json`                            |
| `kimi provider catalog list`     | Browse public model catalog              | `kimi provider catalog list --filter anthropic`        |
| `kimi provider catalog add <id>` | Import provider from catalog             | `kimi provider catalog add anthropic --api-key sk-...` |

Built-in subagents: `coder`, `explore`, `plan`. Sub-skills stable since **0.12.0** (`/sub-skill.review`, `/sub-skill.consolidate`). Latest: **0.14.0** — run `kimi upgrade`.

## Environment variables

| Variable                                  | Purpose                                                   | Example                                                              |
| ----------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------- |
| `KIMI_MODEL_*`                            | Temporary model override (synthesizes provider in memory) | `KIMI_MODEL_PROVIDER=anthropic KIMI_MODEL_MODEL=claude-4-7-20251014` |
| `KIMI_CODE_BACKGROUND_KEEP_ALIVE_ON_EXIT` | Override `keep_alive_on_exit`                             | `KIMI_CODE_BACKGROUND_KEEP_ALIVE_ON_EXIT=true`                       |
| `KIMI_CODE_EXPERIMENTAL_SUB_SKILL`        | Enable experimental sub-skills                            | `KIMI_CODE_EXPERIMENTAL_SUB_SKILL=1`                                 |

> `KIMI_MODEL_*` vars create a temporary provider that does **not** persist after restart. Use `config.toml` for permanent model configuration.

## When to Use (toolchain)

- User asks about project health, diagnostics, or governance
- User modifies `package.json`, `bun.lock`, or `bunfig.toml`
- User reports failures, loops, or unexpected behavior
- User requests scaffolding, templating, or project setup

## Tools

| Command            | Purpose                    | When to Invoke                        |
| ------------------ | -------------------------- | ------------------------------------- |
| `kimi doctor`      | Official Kimi Code config  | MCP/auth/model issues                 |
| `kimi-doctor`      | Toolchain diagnostic suite | Project + desktop sync + MCP wiring   |
| `kimi-heal`        | Failure clusters + plans   | After failures; dry-run before apply  |
| `kimi-decision`    | Decision ledger            | Explain or audit recorded rationale   |
| `kimi-governance`  | R-Score + governance check | After doctor, for scoring             |
| `kimi-guardian`    | Lockfile integrity         | After dep changes, before push        |
| `kimi-fix`         | Scaffold / auto-fix        | When grade is D/F or scaffold request |
| `kimi-context-gen` | CONTEXT.md regeneration    | When freshness is stale               |
| `kimi-githooks`    | Hook management            | On setup or hook issues               |
| `kimi-memory`      | Session + warning trends   | When interpreting recurring warnings  |
| `kimi-debug`       | Failure wizard             | When user asks "what broke?"          |

## Decision Protocol

### Project Health Check

```
0. RUN: kimi-toolchain workspace verify  (or bun run verify-workspace)
   IF cursor-workspace blocker → reopen ~/kimi-toolchain; kimi-toolchain doctor --fix --fix-cursor
1. RUN: kimi doctor          # official Kimi Code config
2. RUN: kimi-toolchain doctor --ecosystem --quick  # cross-product health
3. RUN: kimi-heal plan --json
4. RUN: kimi-governance score
5. PARSE doctor output + R-Score breakdown
6. IF lockfile warning → RUN: kimi-guardian check
7. IF coverage gap → RUN: bun run test:coverage:fast (local) or bun run test:coverage:ci (CI)
8. IF governance gap → RUN: kimi-governance fix
9. QUERY: kimi-memory trends (~/.kimi-code/var/sessions.db warning_trends)
10. PRESENT: current state + trend + next action
```

### Dependency Changes

```
1. MANDATORY: kimi-guardian check (includes manifest verify)
2. IF guardian FAILS (HASH MISMATCH / unsigned):
   a. BLOCK any push or further dep suggestions
   b. ASK: "Run kimi-guardian sign to baseline intentionally?"
3. IF guardian PASSES → continue workflow
```

### Failure Recovery ("What broke?")

```
1. RUN: kimi-debug last
2. RUN: kimi-debug wire [path-to-wire.jsonl]   # classify recent failures
3. QUERY: ~/.kimi-code/var/tool-failures.jsonl for recurring patterns (taxonomyId, suggestion, autoFix)
4. RUN: kimi-heal clusters --json
5. RUN: kimi-heal plan --json
6. RUN: kimi-decision audit --json
7. QUERY: kimi-memory trends + doctor_runs in ~/.kimi-code/var/sessions.db (grouped by taxonomy_id when present)
8. RUN: git log --oneline -20
9. IF CONTEXT.md stale → RUN: kimi-context-gen freshness / update
10. PRESENT: timeline + taxonomy id + likely cause + recovery steps (use heal plan first; taxonomy autoFix only when safe)
```

Use `kimi-debug analyze --json` or `kimi-debug classify <text>` for taxonomy ids (`max_steps_exceeded`, `lockfile_issue`, etc.) from `~/.kimi-code/error-taxonomy.yml`.

### Scaffold New Project

```
1. RUN: kimi-new <project-name> [--path <parent-dir>]
   Or: mkdir <name> && bun init -y && kimi-fix .
2. cd <project-name>
3. RUN: kimi-fix doctor .         # verify scaffold completeness
4. RUN: kimi-governance score (target grade ≥ C)
5. RUN: kimi login                # Kimi Code CLI
6. REMIND: customize AGENTS.md one-liner, CODE_REFERENCES.md local exemplars, and CODEOWNERS (@team) before commit
```

### Before Commit or Push

```
1. RUN: kimi-githooks doctor
2. LOCAL (fast): bun run check:fast
3. BEFORE PUSH: managed pre-push runs check:fast by default; use KIMI_PRE_PUSH_FULL=1 git push for a full local gate
4. RUN: kimi-guardian check
5. IF tools, docs, skills, templates, or generated runtime assets changed:
   RUN: bun run sync && bun run sync:verify
6. RUN: kimi-governance score (pre-push blocks F/D)
```

## R-Score Interpretation

R-Score is **points out of 110** with letter grades derived from decimal % of max.

| % of Max | Grade | Action                         |
| -------- | ----- | ------------------------------ |
| ≥ 90%    | A     | Maintain                       |
| ≥ 80%    | B     | Minor fixes                    |
| ≥ 70%    | C     | Address warnings               |
| ≥ 60%    | D     | Run `kimi-fix`, governance fix |
| < 60%    | F     | Halt; full audit with doctor   |

## Security Boundaries

- **Never** suggest `git push --no-verify` to bypass hooks
- **Never** ignore `kimi-guardian` failures
- **Never** use YOLO (`-y`) with MCP shell tools unless user fully trusts servers
- **Never** hand-edit `~/.kimi-code/sessions/` or `credentials/`
- **Prefer** `Bun.secrets` over `.env` files

## Session Memory

Toolchain state: `~/.kimi-code/var/sessions.db` (not Kimi Code `sessions/wd_*`).

```bash
kimi-memory trends
kimi-memory recall
kimi-memory search <k>
```

## MCP (toolchain)

Unified-shell bridge is auto-registered in `~/.kimi-code/mcp.json` on `bun run sync`. The sync writes `~/.kimi-code/toolchain-manifest.json` with source hashes. Verify runtime-synced assets with `bun run sync && bun run sync:verify`. Verify MCP wiring with `kimi-doctor --quick` MCP section or `kimi` → `/mcp`.

## Hook taxonomy

Three hook systems coexist. Use the right name:

| System                    | Where it lives                                             | Toolchain command                              |
| ------------------------- | ---------------------------------------------------------- | ---------------------------------------------- |
| Git hooks                 | `.git/hooks/`                                              | `kimi-githooks install`                        |
| Bun package hook          | `src/install-hooks/postinstall.ts`                         | Runs on `bun install`                          |
| Kimi Code lifecycle hooks | `~/.kimi-code/config.toml` `[[hooks]]` → `src/kimi-hooks/` | `kimi-doctor --fix` seeds `PostToolUseFailure` |

## Synced skills

`bun run sync` copies all repo `skills/` directories to `~/.kimi-code/skills/` and `~/.agents/skills/` (3 bundled: `kimi-toolchain`, `cloudflare-access`, `herdr`).

## Runtime paths

Canonical `~/.kimi-code/` layout is defined in `src/lib/paths.ts` (`desktopRoot()`, `skillsDir()`, `taxonomyPath()`, etc.). Key agent-facing paths:

| Path                                   | Purpose                                            |
| -------------------------------------- | -------------------------------------------------- |
| `~/.kimi-code/UNIFIED.md`              | Kimi Code vs kimi-toolchain map (synced from repo) |
| `~/.kimi-code/error-taxonomy.yml`      | Failure taxonomy schema                            |
| `~/.kimi-code/var/tool-failures.jsonl` | Classified tool failure ledger                     |
| `~/.kimi-code/var/sessions.db`         | Toolchain memory (not Kimi `sessions/wd_*`)        |
| `~/.kimi-code/toolchain-manifest.json` | Sync metadata + source hashes                      |

## Related

- Repo: https://github.com/brendadeeznuts1111/kimi-toolchain
- `~/.kimi-code/UNIFIED.md`: product matrix, MCP, ACP, editor workflows
- Kimi docs: https://moonshotai.github.io/kimi-code/
  - Kimi command reference: https://moonshotai.github.io/kimi-code/en/reference/kimi-command.html
