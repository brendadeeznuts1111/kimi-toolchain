---
name: kimi-toolchain
description: |
  Teaches agents to operate kimi-toolchain CLI and align with Kimi Code docs.
  Use for kimi-doctor, kimi-governance, kimi-guardian, kimi-fix, or project health.
  For Kimi Code config/MCP/sessions use `kimi` and `kimi doctor` (official).
whenToUse: |
  Project health, R-Score, lockfile security, scaffolding, or Bun quality gates.
  Kimi Code slash commands (/mcp, /goal) and ACP are separate from toolchain CLIs.
---

# kimi-toolchain

## Kimi Code vs toolchain

| Need                                | Use                                                   |
| ----------------------------------- | ----------------------------------------------------- |
| Kimi config, OAuth, models          | `kimi doctor` (official)                              |
| MCP servers, `/mcp-config`          | `kimi` TUI or edit `~/.kimi-code/mcp.json`            |
| Sessions, goals, subagents          | `kimi` / `kimi --continue` from project cwd           |
| Zed/JetBrains agent                 | `kimi acp` (absolute path to `~/.kimi-code/bin/kimi`) |
| R-Score, guardian, hooks, Bun gates | `kimi-doctor`, `kimi-governance`, `bun run check`     |

**`kimi doctor` (Moonshot) ≠ `kimi-doctor` (toolchain).** Run both after toolchain changes.

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

Built-in subagents: `coder`, `explore`, `plan`. Sub-skills stable since **0.12.0** (`/sub-skill.review`, `/sub-skill.consolidate`). Latest: **0.14.0** — run `kimi upgrade`.

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
1. RUN: kimi doctor          # official Kimi Code config
2. RUN: kimi-doctor --quick  # toolchain + MCP + path alignment
3. RUN: kimi-governance score
4. PARSE doctor output + R-Score breakdown
5. IF lockfile warning → RUN: kimi-guardian check
6. IF coverage gap → RUN: bun run test:coverage:fast (local) or bun run test:coverage:ci (CI)
7. IF governance gap → RUN: kimi-governance fix
8. QUERY: kimi-memory trends (sessions.db warning_trends)
9. PRESENT: current state + trend + next action
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
2. QUERY: kimi-memory trends + doctor_runs in sessions.db
3. RUN: git log --oneline -20
4. IF CONTEXT.md stale → RUN: kimi-context-gen freshness / update
5. PRESENT: timeline + likely cause + recovery steps
```

### Scaffold New Project

```
1. mkdir <project-name> && cd <project-name>
2. bun init -y                    # sets package.json name (used in AGENTS.md, README)
3. RUN: kimi-fix . [--dry-run]
   Creates: AGENTS.md, CONTEXT.md, .kimi-code/, quality scripts, CI
4. RUN: kimi-governance score (target grade ≥ C)
5. RUN: kimi-githooks install (also run by kimi-fix)
6. REMIND: customize AGENTS.md one-liner + CODEOWNERS before commit
```

### Before Commit or Push

```
1. RUN: kimi-githooks doctor
2. LOCAL (fast): bun run check:fast
3. BEFORE PUSH: bun run check
4. RUN: kimi-guardian check
5. RUN: kimi-governance score (pre-push blocks F/D)
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

Unified-shell bridge is auto-registered in `~/.kimi-code/mcp.json` on `bun run sync`. Verify with `kimi-doctor --quick` MCP section or `kimi` → `/mcp`.

## Related

- Repo: https://github.com/brendadeeznuts1111/kimi-toolchain
- UNIFIED.md: product matrix, MCP, ACP, editor workflows
- Kimi docs: https://moonshotai.github.io/kimi-code/
