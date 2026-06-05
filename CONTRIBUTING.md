# Contributing to kimicode-cli

## Development Setup

```bash
bun install
bun test       # add a test script to package.json
bun run lint   # add a lint script to package.json
```

## Pull Request Process

1. Run `kimi-doctor --fix` before committing
2. Ensure R-Score ≥ 0.7 (run `kimi-governance score`)
3. Update CHANGELOG.md for user-facing changes
4. Request review from CODEOWNERS

## Commit Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — new feature
- `fix:` — bug fix
- `docs:` — documentation only
- `refactor:` — code change that neither fixes a bug nor adds a feature
- `test:` — adding or correcting tests
- `chore:` — maintenance tasks

## Questions?

Open an issue or contact the maintainers.
