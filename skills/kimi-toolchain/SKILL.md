---
name: kimi-toolchain
description: |
  Teaches agents to operate kimi-toolchain CLI and align with Kimi Code docs.
  Use for kimi-doctor, kimi-governance, kimi-guardian, kimi-fix, kimi-heal,
  causal traces, capabilities, signed contracts, or project health.
  For Kimi Code config/MCP/sessions use `kimi` and `kimi doctor` (official).
whenToUse: |
  Project health, R-Score, lockfile security, scaffolding, introspection,
  self-healing, signed contracts, or Bun quality gates.
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

- User asks about project health, diagnostics, introspection, self-healing, or governance
- User modifies `package.json`, `bun.lock`, or `bunfig.toml`
- User reports failures, loops, or unexpected behavior
- User requests scaffolding, templating, or project setup
- User asks why a toolchain decision was made, why a trace failed, or whether a contract/capability is trusted
- User asks to plan or prioritize self-awareness, self-correction, failure-ledger, contract-integration, verification, or developer-experience work from `ROADMAP.md`

## Tools

| Command             | Purpose                        | When to Invoke                           |
| ------------------- | ------------------------------ | ---------------------------------------- |
| `kimi doctor`       | Official Kimi Code config      | MCP/auth/model issues                    |
| `kimi-doctor`       | Toolchain diagnostic suite     | Project + desktop sync + MCP wiring      |
| `kimi-capabilities` | Live integration readiness     | Before debugging degraded MCP/hooks/auth |
| `kimi-trace`        | Causal graph reconstruction    | When a trace-id or nested failure exists |
| `kimi-heal`         | Failure clustering + heal plan | After failures; always dry-run first     |
| `kimi-contract`     | Signed contract trust          | When contracts/providers change          |
| `kimi-decision`     | Decision ledger                | When listing or recording rationale      |
| `kimi-why`          | Decision ledger alias          | When explaining previous choices         |
| `kimi-governance`   | R-Score + governance check     | After doctor, for scoring                |
| `kimi-guardian`     | Lockfile integrity             | After dep changes, before push           |
| `kimi-fix`          | Scaffold / auto-fix            | When grade is D/F or scaffold request    |
| `kimi-context-gen`  | CONTEXT.md regeneration        | When freshness is stale                  |
| `kimi-githooks`     | Hook management                | On setup or hook issues                  |
| `kimi-memory`       | Session + warning trends       | When interpreting recurring warnings     |
| `kimi-debug`        | Failure wizard                 | When user asks "what broke?"             |

## Agent Operating Loop

Use this loop before editing source, docs, hooks, or CI:

1. **Observe**: Run the narrow state command first (`kimi-githooks doctor`, `kimi-capabilities --json`, `kimi-heal plan --json`, or the failing targeted test).
2. **Scope**: Read `CODE_REFERENCES.md`, choose the closest existing pattern, and name the smallest change that can satisfy the request.
3. **Implement**: Keep parsing, subprocess calls, sync paths, and telemetry boundaries typed and local to the established module.
4. **Guard**: Add or update a detector/test when fixing a mistake, stale default, naming drift, or skipped gate.
5. **Validate**: Run the targeted test, then `bun run check:fast`; run `bun run check` before handoff when hooks, gates, smoke paths, or synced runtime files changed.
6. **Sync**: Run `bun run sync && bun run sync:verify` after changing tools, docs, skills, or generated runtime assets.

## Introspection + Self-Healing Protocol

All new introspection commands support `--json` for machine-readable output.
Use them before reading implementation when the question is about current toolchain state:
`kimi-capabilities` answers "what is alive?", `kimi-trace` answers "what caused this?",
`kimi-contract` answers "can I trust this declaration?", and `kimi-heal` answers
"what can be safely repaired?".
Effect-native agents can use `KimiIntrospectionLive` from
`src/lib/effect/kimi-introspection-services.ts` instead of spawning CLI commands.

```
1. RUN: kimi-capabilities --json
2. IF trace-id is known → RUN: kimi-trace <trace-id> --json
3. RUN: kimi-heal plan --json
4. IF plan has safe auto-applicable actions:
   a. RUN: kimi-heal apply --dry-run --json
   b. ONLY with explicit user intent or pre-approved safe sync: kimi-heal apply --yes --action <id>
5. IF contract trust is degraded → RUN: kimi-contract validate --json
6. IF a decision needs explanation → RUN: kimi-why <decision-id|topic> --json
7. IF recent rationale is needed → RUN: kimi-decision log --limit 10 --json
```

`kimi-heal apply` is dry-run by default. It may only execute actions marked
`safeToAutoApply`; manual or blocked actions stay skipped until a human handles
the underlying risk. Examples: `bun run sync` for runtime drift is safe;
guardian baseline changes, dependency installs, signing keys, and source edits
remain manual.

## Decision Protocol

### Project Health Check

```
0. RUN: kimi-toolchain workspace verify  (or bun run verify-workspace)
   IF cursor-workspace blocker → reopen ~/kimi-toolchain; kimi-toolchain doctor --fix --fix-cursor
1. RUN: kimi doctor          # official Kimi Code config
2. RUN: kimi-toolchain doctor --ecosystem --quick  # cross-product health
3. RUN: kimi-capabilities --json
4. RUN: kimi-heal plan --json
5. RUN: kimi-governance score
6. PARSE doctor output + R-Score breakdown
7. IF lockfile warning → RUN: kimi-guardian check
8. IF coverage gap → RUN: bun run test:coverage:fast (local) or bun run test:coverage:ci (CI)
9. IF governance gap → RUN: kimi-governance fix
10. QUERY: kimi-memory trends (sessions.db warning_trends)
11. PRESENT: current state + trend + next action
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
3. QUERY: ~/.kimi-code/var/tool-failures.jsonl for recurring patterns (taxonomyId, traceId, suggestion, autoFix)
4. IF traceId exists → RUN: kimi-trace <traceId> --json
5. RUN: kimi-heal clusters --json
6. RUN: kimi-heal plan --json
7. QUERY: kimi-memory trends + doctor_runs in sessions.db (grouped by taxonomy_id when present)
8. RUN: git log --oneline -20
9. IF CONTEXT.md stale → RUN: kimi-context-gen freshness / update
10. PRESENT: timeline + taxonomy id + root cause chain + recovery steps (use heal plan first; taxonomy autoFix only when safe)
```

Use `kimi-debug analyze --json` or `kimi-debug classify <text>` for taxonomy ids (`max_steps_exceeded`, `lockfile_issue`, etc.) from `error-taxonomy.yml`.

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
5. RUN: bun run sync && bun run sync:verify
6. RUN: kimi-governance score (pre-push blocks F/D)
```

### Regression Hygiene

- After fixing a tooling mistake, add a detector or gate for that failure mode, then search generated scaffolds, CI config, README, AGENTS.md, skills, and test gate lists for the same stale pattern.
- Test files should declare their class in the filename: `.unit.test.ts`, `.integration.test.ts`, or `.smoke.test.ts`. Keep each classified file in the matching `src/lib/test-gates.ts` list.
- Git rename helpers can stage changes. After `git mv` or other index-touching commands, run `git diff --cached --stat`; unstage with `git restore --staged ...` unless the user asked to stage/commit.
- Search patterns containing backticks, `$()`, pipes, or other shell metacharacters need single-quoted patterns or `rg -e` arguments so the shell cannot execute the search text.

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

## Hook taxonomy

Three hook systems coexist. Use the right name:

| System                    | Where it lives                                             | Toolchain command                              |
| ------------------------- | ---------------------------------------------------------- | ---------------------------------------------- |
| Git hooks                 | `.git/hooks/`                                              | `kimi-githooks install`                        |
| Bun package hook          | `src/install-hooks/postinstall.ts`                         | Runs on `bun install`                          |
| Kimi Code lifecycle hooks | `~/.kimi-code/config.toml` `[[hooks]]` → `src/kimi-hooks/` | `kimi-doctor --fix` seeds `PostToolUseFailure` |

## Schema Notes

- `tool-failures.jsonl` records `schemaVersion`, `taxonomyId`, `traceId`, `parentTraceId`, `childTraceIds`, and structured `context.inputs` / `context.environment`.
- `trace-events.jsonl` records `schemaVersion`, `traceId`, `parentTraceId`, `childTraceIds`, `eventType`, `tool`, timing, status, command/cwd, and metadata. `kimi-trace --json` exposes `TraceGraph.rootCauseChain` and `nodes[].failures[]`.
- `capabilities/*.json` snapshots store `CapabilityReport` with grep-friendly `readiness`, canonical `readinessScore`, healthy/degraded/unavailable counts, and `checks[]` entries with `id`, `type`, `status`, `summary`, `latencyMs`, and optional `details`.
- `<contract>.sig` files store Ed25519 `ContractSignatureEnvelope` values: `schemaVersion`, `algorithm`, `keyId`, `signatureHex`, `payloadSha256`, and `signedAt`. Embedded `x-kimi-signature` fields are stripped from normalized payloads. Trusted public keys live in project-root `trusted-keys.json` as a direct key map or `{ "keys": { ... } }`.
- `docs/agent-api.md` documents `KimiCapabilities`, `KimiTrace`, `KimiContract`, and `KimiIntrospectionLive` for Effect programs that should compose introspection without subprocesses.
- `decision-ledger.jsonl` stores `kimi-decision` / `kimi-why` records with `decisionId`, `actor`, `action`, `trigger`, optional `clusterId`, `rationale`, `alternativesConsidered`, `outcome`, trace aliases, and parent/child decision links. Self-heal applies append a decision when an action actually runs.
- Repo-local generated outputs belong under `.kimi-artifacts/`; test homes, coverage, JUnit reports, and disposable markers should not be created at repo root.
- `bun run sync` regenerates `~/.kimi-code/toolchain-manifest.json`; `bun run sync:verify` verifies manifest hashes and desktop drift and is part of the managed pre-push hook.

## Related

- Repo: https://github.com/brendadeeznuts1111/kimi-toolchain
- UNIFIED.md: product matrix, MCP, ACP, editor workflows
- Kimi docs: https://moonshotai.github.io/kimi-code/
  - Kimi command reference: https://moonshotai.github.io/kimi-code/en/reference/kimi-command.html
