# kimicode-cli

> AI-native dev tooling powered by Kimi Code CLI
>
> `https://github.com/brendadeeznuts1111/kimicode-cli`

## Install

```bash
# Global install (recommended)
bun install -g github:brendadeeznuts1111/kimicode-cli

# Or clone and link
git clone https://github.com/brendadeeznuts1111/kimicode-cli.git
cd kimicode-cli
bun install -g .
```

## Commands

| Command | Description |
|---------|-------------|
| `kimi-doctor` | Full toolchain diagnostics |
| `kimi-fix` | Auto-repair toolchain gaps |
| `kimi-governance score` | Compute R-Score for current project |
| `kimi-governance fix` | Auto-generate missing governance files |
| `kimi-guardian check` | Lockfile integrity & CVE scan |
| `kimi-memory doctor` | Session store health check |
| `kimi-memory trends` | Persistent warning tracking |
| `kimi-githooks install` | Install pre-commit + pre-push hooks |
| `kimi-context-gen update` | Regenerate CONTEXT.md |

## Project Structure

```
src/
  bin/          # CLI tools (kimi-doctor, kimi-governance, etc.)
  lib/          # Shared utilities (utils.ts)
  hooks/        # postinstall.ts, pre-push
  guardian/     # Lockfile verifier
  drift/        # Dependency drift detector
```

Live runtime at `~/.kimi-code/` (managed by postinstall hook).

## Governance

- R-Score: run `kimi-governance score`
- License: MIT
- [CONTRIBUTING.md](./CONTRIBUTING.md)

## Safety

- No secrets in source. Use `Bun.env` or `Bun.secrets`.
- Validate all external input at system boundaries.
