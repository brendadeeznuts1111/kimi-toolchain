# {{name}}

Bun-native HTTP dashboard scaffolded from [kimi-toolchain](https://github.com/brendadeeznuts1111/kimi-toolchain).

## Quickstart

```bash
bun install
bun run dev
# Open http://localhost:3000
```

## API Routes

| Route      | Description                                               |
| ---------- | --------------------------------------------------------- |
| `/health`  | Runtime info: version, pid, uptime, memory                |
| `/inspect` | `Bun.inspect()` with default vs configured options        |
| `/env`     | Environment variables + `Bun.TOML.parse()` bunfig         |
| `/crypto`  | `Bun.CryptoHasher`, `Bun.randomUUIDv7`, `Bun.nanoseconds` |

## Extend

Copy more endpoints from `examples/dashboard/` in kimi-toolchain:

- `Bun.password` — argon2id hashing
- `bun:sqlite` — in-memory SQLite
- `Bun.markdown.html()` — markdown rendering
- `Bun.Glob` — file pattern matching
- `Bun.Shell ($)` — shell commands
- `node:os` — system info

## Scaffold more APIs

```bash
cd ~/kimi-toolchain/examples/dashboard
# Explore 40+ Bun API demos
```
