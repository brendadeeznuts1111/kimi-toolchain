# Contributing to kimi-toolchain

## Development Setup

```bash
git clone https://github.com/brendadeeznuts1111/kimi-toolchain.git ~/kimi-toolchain
cd ~/kimi-toolchain
bun install
bun run unify          # sync → ~/.kimi-code/, PATH wrappers
```

## Before You Commit

```bash
bun run format         # oxfmt --write .
bun run format:check   # must pass in CI
bun run lint           # oxlint
bun run test           # smoke tests
bun run typecheck      # tsc --noEmit (required)
kimi-doctor --quick    # toolchain health
```

Config: `.oxfmtrc.json` (formatter), `.oxlintrc.json` (linter). See `AGENTS.md` and `TEMPLATES.md`.

## Pull Request Process

1. Run `kimi-doctor --fix` before committing
2. Ensure `bun run check` passes (format:check, lint, typecheck, test)
3. Ensure R-Score ≥ 0.7 (`kimi-governance score`)
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

## Questions?

- Open an issue: https://github.com/brendadeeznuts1111/kimi-toolchain/issues
- Contact the maintainers (see CODEOWNERS)
