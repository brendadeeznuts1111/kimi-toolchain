---
title: "CONTRIBUTING"
tags: [root]
category: root
status: draft
priority: medium
---
# Contributing to kimi-toolchain

## Development Setup

```bash
git clone https://github.com/brendadeeznuts1111/kimi-toolchain.git ~/kimi-toolchain
cd ~/kimi-toolchain
bun install
bun run unify          # sync → ~/.kimi-code/, PATH wrappers
```

## Multi-worktree Git

This repo uses linked worktrees (Herdr, Codex, etc.). If `pwd` is `~/kimi-toolchain` but `git rev-parse --show-toplevel` points elsewhere, Git is resolving the wrong worktree — `git status` may show unrelated branch changes.

Pin the canonical clone before commit/push:

```bash
export GIT_DIR=~/kimi-toolchain/.git GIT_WORK_TREE=~/kimi-toolchain
git rev-parse --show-toplevel   # must print ~/kimi-toolchain
git status --short
```

List worktrees: `git worktree list`. Open Cursor at `~/kimi-toolchain` (folder name must match `package.json` `name`).

## Before You Commit

```bash
bun run format         # oxfmt --write .
bun run check:fast     # format + lint + typecheck + unit tests (~3s)
bun run check          # full gate including smoke tests (~30s)
kimi-doctor --quick    # toolchain health
```

Preview gates without running: `bun run check:dry-run`

Pre-commit hook runs format, lint, typecheck, and `test:fast`. Full `bun run check` runs on pre-push.

Config: `.oxfmtrc.json` (formatter), `.oxlintrc.json` (linter), `bunfig.toml` (test runner). See `AGENTS.md` and `TEMPLATES.md`.

## Testing

Read **`test/testing.md`** before adding or changing tests. Execution model (fast / changed / parallel / shard): **`docs/references/testing-execution.md`**. Runtime contracts live in **`src/lib/test-runtime.ts`** (contract tests: `test/test-runtime.unit.test.ts`). File lists and timeouts: **`src/lib/test-gates.ts`**. Naming rules: **`scripts/lint-test-names.ts`**. Doc drift gate: **`bun run scripts/lint-testing-docs.ts`**.

For single-file debug use bare Bun (`bun test test/foo.unit.test.ts`, `bun test --coverage`). Hooks and CI use tier scripts (`bun run test:fast`, `bun run test`).

External references:

- [Bun writing tests](https://bun.com/docs/test/writing-tests)
- [Bun run tests](https://bun.com/docs/test#run-tests)
- [`bun:test` module reference](https://bun.com/reference/bun/test)

## Pull Request Process

1. Run `kimi-doctor --fix` before committing
2. Ensure `bun run check` passes (format:check, lint, typecheck, test)
3. Ensure R-Score grade ≥ B (`kimi-governance score`, ≥88/110)
4. Update CHANGELOG.md for user-facing changes
5. Request review from CODEOWNERS

## Commit Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — new feature
- `fix:` — bug fix
- `docs:` — documentation only
- `refactor:` — code change that neither fixes a bug nor adds a feature
- `test:` — adding or correcting tests
- `chore:` — maintenance tasks

## Questions

- Open an issue: https://github.com/brendadeeznuts1111/kimi-toolchain/issues
- Contact the maintainers (see CODEOWNERS)
## Related

- [INDEX.md](../INDEX.md) — Documentation index
