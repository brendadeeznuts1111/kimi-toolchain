---
name: kimi-toolchain
description: |
  Tier-1380 operational protocol for the kimi-toolchain. Teaches agents when
  to run which tool, in what order, and how to connect diagnostics across
  guardian → governance → memory → fix. Use when working with projects that
  use kimi-doctor, kimi-governance, kimi-guardian, or any kimi-* CLI tool.
triggers: ["kimi", "doctor", "governance", "guardian", "fix", "r-score", "lockfile"]
version: 0.1.0
---

# kimi-toolchain — Agent Decision Protocol

## Philosophy

**Don't guess. Run the tool.** The toolchain exists so agents don't need to
remember checklists. Every project health question starts with `kimi-doctor`.
Every dependency change triggers `kimi-guardian`. Every commit should pass
`kimi-governance score`.

## Decision Trees

### When user asks about project health

```
1. RUN: kimi-doctor
2. IF doctor shows warnings:
   a. IF warnings contain "lockfile" → RUN: kimi-guardian check
   b. IF warnings contain "coverage" → RUN: bun test --coverage
   c. IF warnings contain "governance" → RUN: kimi-governance score
3. IF R-Score grade is "F" or "D" → SUGGEST: kimi-governance fix
4. ALWAYS: SHOW persistent warnings from kimi-memory trends
```

### When user modifies package.json or bun.lock

```
1. MANDATORY: RUN: kimi-guardian check
2. IF guardian fails (HASH MISMATCH / unbaselined):
   a. BLOCK any further dependency suggestions
   b. ASK user: "Run 'kimi-guardian sign' to baseline?"
3. IF guardian passes → CONTINUE with normal workflow
```

### When user asks "what broke?" or "why is this failing?"

```
1. RUN: kimi-doctor
2. QUERY: sessions.db for recent doctor_runs (last 24h)
3. IF git repo:
   a. SHOW: git log --oneline -5
   b. SHOW: git diff since last known-good commit
4. IF CONTEXT.md is stale (>30 days since update):
   SUGGEST: kimi-context-gen update
5. IF failure pattern matches known issue in memory:
   SHOW: kimi-memory search <error-keyword>
```

### When user wants to scaffold a new project

```
1. RUN: kimi-fix <project-path>
2. IF --dry-run passed → SHOW what would be created, STOP
3. AFTER fix completes:
   a. RUN: kimi-governance score (should be ≥ C)
   b. RUN: kimi-doctor (should pass)
   c. RUN: kimi-githooks install
4. REMIND: "Review generated files before committing"
```

### When user is about to commit or push

```
1. CHECK: Are git hooks installed? (kimi-githooks doctor)
2. RUN: kimi-guardian check (pre-push gate)
3. RUN: kimi-governance score (blocks push if F/D)
4. IF pre-commit hook not installed → SUGGEST: kimi-githooks install
```

## Tool Reference

| Tool | When to use | Key commands |
|------|-------------|--------------|
| `kimi-doctor` | Any health check, any suspicion | `kimi-doctor`, `kimi-doctor --fix` |
| `kimi-fix` | New project, missing files | `kimi-fix <path>`, `kimi-fix <path> --dry-run` |
| `kimi-governance` | Quality gates, R-Score | `score`, `fix`, `coverage [N]`, `docs`, `adr` |
| `kimi-guardian` | Lockfile, deps, security | `check`, `sign`, `verify`, `report` |
| `kimi-memory` | Session tracking, trends | `doctor`, `trends`, `store`, `recall`, `graph` |
| `kimi-githooks` | Git workflow | `install`, `doctor`, `fix` |
| `kimi-context-gen` | Documentation | `scan`, `update`, `freshness` |
| `kimi-release` | Versioning | `changelog`, `semver`, `validate` |
| `kimi-debug` | Failure analysis | `last`, `diff`, `trace`, `analyze` |
| `kimi-snapshot` | Environment capture | `save`, `restore`, `list`, `show` |
| `kimi-resource-governor` | Resource limits | `limits`, `spawn`, `cache`, `status` |

## Session Memory

The toolchain tracks warnings across runs in `~/.kimi-code/var/sessions.db`.

Query persistent warnings:
```bash
kimi-memory trends
```

This distinguishes "new warning = immediate action" from
"old warning = accepted risk". Always check trends before escalating.

## Safety Boundaries

- **Never** suggest `kimi-guardian sign` without confirming user intentionally
  modified dependencies
- **Never** bypass pre-push hooks with `--no-verify`
- **Always** run `kimi-doctor` before suggesting `kimi-fix --dry-run`
- **Respect** `.env` files — pre-commit hook blocks them, don't suggest workarounds

## Related

- Repo: https://github.com/brendadeeznuts1111/kimi-toolchain
- AGENTS.md: `~/.kimi-code/AGENTS.md`
- Tools: `~/.kimi-code/tools/`
