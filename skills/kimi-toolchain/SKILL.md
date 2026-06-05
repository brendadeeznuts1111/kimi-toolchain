---
name: kimi-toolchain
description: |
  Teaches agents to operate the kimi-toolchain CLI effectively.
  Use when working with kimi-doctor, kimi-governance, kimi-guardian, kimi-fix,
  or any kimi-* CLI tool.
triggers:
  [
    "kimi",
    "doctor",
    "governance",
    "guardian",
    "fix",
    "r-score",
    "lockfile",
    "project health",
    "what broke",
  ]
version: 0.2.0
---

# kimi-toolchain

Teaches agents to operate the kimi-toolchain CLI effectively.

## When to Use

- User asks about project health, diagnostics, or governance
- User modifies `package.json`, `bun.lock`, or `bunfig.toml`
- User reports failures, loops, or unexpected behavior
- User requests scaffolding, templating, or project setup

## Tools

| Command            | Purpose                    | When to Invoke                        |
| ------------------ | -------------------------- | ------------------------------------- |
| `kimi-doctor`      | Full diagnostic suite      | Always first on health questions      |
| `kimi-governance`  | R-Score + governance check | After doctor, for scoring             |
| `kimi-guardian`    | Lockfile integrity         | After dep changes, before push        |
| `kimi-fix`         | Scaffold / auto-fix        | When grade is D/F or scaffold request |
| `kimi-context-gen` | CONTEXT.md regeneration    | When freshness is stale               |
| `kimi-githooks`    | Hook management            | On setup or hook issues               |
| `kimi-memory`      | Session + warning trends   | When interpreting recurring warnings  |
| `kimi-debug`       | Failure wizard             | When user asks "what broke?"          |

## Scenario Comparison

| Scenario                  | Without Skill                             | With Skill                                                                                           |
| ------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| "Check my project health" | Generic file listing, maybe suggests `ls` | Run `kimi-doctor`, then `kimi-governance score`; interpret R-Score; suggest `kimi-governance fix`    |
| "I updated dependencies"  | Generic "test it" advice                  | Run `kimi-guardian check`; block if HASH MISMATCH or unsigned manifest; suggest `sign` + drift check |
| "What broke?"             | Generic git diff suggestion               | Run `kimi-debug last`, query `kimi-memory trends`, show warning history, suggest wizard steps        |
| "Scaffold a new project"  | Generic file creation                     | Run `kimi-fix`, validate with `kimi-governance score`, install `kimi-githooks`, suggest next steps   |

## Decision Protocol

### Project Health Check

```
1. RUN: kimi-doctor
2. RUN: kimi-governance score
3. PARSE doctor output + R-Score breakdown
4. IF lockfile warning → RUN: kimi-guardian check
5. IF coverage gap → RUN: bun test --coverage
6. IF governance gap → RUN: kimi-governance fix
7. QUERY: kimi-memory trends (sessions.db warning_trends)
8. PRESENT: current state + trend + next action
```

### Dependency Changes

```
1. MANDATORY: kimi-guardian check (includes manifest verify)
2. IF guardian FAILS (HASH MISMATCH / unsigned):
   a. BLOCK any push or further dep suggestions
   b. ASK: "Run kimi-guardian sign to baseline intentionally?"
3. IF guardian PASSES → continue workflow
4. OPTIONAL: bun run src/drift/check.ts (dependency drift)
```

### Failure Recovery ("What broke?")

```
1. RUN: kimi-debug last
2. QUERY: kimi-memory trends + doctor_runs in sessions.db
3. RUN: git log --oneline -20
4. RUN: git diff <last_green>..HEAD (if known)
5. CHECK: bun.lock for recent changes
6. IF CONTEXT.md stale → RUN: kimi-context-gen freshness / update
7. PRESENT: timeline + likely cause + recovery steps
```

### Scaffold New Project

```
1. RUN: kimi-fix <path> [--dry-run]
2. RUN: kimi-governance score (target grade ≥ C)
3. RUN: kimi-githooks install
4. REMIND: review generated files before commit
```

### Before Commit or Push

```
1. RUN: kimi-githooks doctor
2. RUN: bun run check (format:check + lint + typecheck + test)
3. RUN: kimi-guardian check
4. RUN: kimi-governance score (pre-push blocks F/D)
```

## R-Score Interpretation

R-Score is **points out of 110** with letter grades derived from decimal % of max (e.g. `C (87.3/110, 79.4%)`). Coverage contributes fractional points.

| % of Max | Grade | Points (approx) | Meaning    | Action                         |
| -------- | ----- | --------------- | ---------- | ------------------------------ |
| ≥ 90%    | A     | ≥ 99/110        | Excellent  | Maintain                       |
| ≥ 80%    | B     | ≥ 88/110        | Good       | Minor fixes                    |
| ≥ 70%    | C     | ≥ 77/110        | Acceptable | Address warnings               |
| ≥ 60%    | D     | ≥ 66/110        | At risk    | Run `kimi-fix`, governance fix |
| < 60%    | F     | < 66/110        | Critical   | Halt; full audit with doctor   |

Key breakdown weights: license/contributing/codeowners/readme/context (10 each),
changelog (5 bonus), testCoverage (25), docsFresh (15), noStaleLockfile (10).

## Security Boundaries

- **Never** suggest `git push --no-verify` to bypass hooks
- **Never** ignore `kimi-guardian` failures
- **Always** verify lockfile after dependency changes (`kimi-guardian check`)
- **Prefer** `Bun.secrets` over `.env` files (pre-commit blocks `.env`)
- **Never** suggest `kimi-guardian sign` unless user intentionally changed deps

## Session Memory

State lives in `~/.kimi-code/var/sessions.db`. Query via:

```bash
kimi-memory trends      # warning_trends — new vs accepted risk
kimi-memory recall      # recent sessions
kimi-memory search <k>  # knowledge graph lookup
```

Tables: `sessions`, `doctor_runs`, `warning_trends`, `knowledge_nodes`.

Distinguish **new warning → act now** from **old warning → accepted risk**.

## Examples

Bundled walkthroughs in `examples/`:

- `examples/doctor-smell.md` — project health check
- `examples/guardian-failure.md` — dependency / lockfile failure
- `examples/what-broke.md` — failure recovery

## Related

- Repo: https://github.com/brendadeeznuts1111/kimi-toolchain
- AGENTS.md: `~/.kimi-code/AGENTS.md`
- Tools: `~/.kimi-code/tools/`
