# kimi-toolchain Dashboard

Demo of every B3.x toolchain feature in one page.

## Start

```bash
cd examples/dashboard
bun run src/index.ts
# Open http://localhost:3000
```

## API Routes

| Route | Feature | Backend |
|-------|---------|---------|
| `/api/bundle` | Bundle analysis | `kimi-doctor --bundle --json` |
| `/api/compile` | Compile check | `kimi-doctor --compile-check --json` |
| `/api/gates` | Gate health | `kimi-doctor --effect-gates --json` |
| `/` | Dashboard UI | Single-page HTML with vanilla JS |

## What's demonstrated

| Feature | Demo vehicle |
|---------|-------------|
| Bundle analysis | Largest modules table, node_modules bloat warnings |
| Compile check | ESM+bytecode badge, cpu-prof-md, heap-prof-md, gate status |
| Gate health | Effect discipline pass/fail, violation list |
| Markdown rendering | Feature table rendered in-browser |

## Scaffold with bun create

```bash
cp -r ~/kimi-toolchain/templates/bun-create/kimi-toolchain ~/.bun-create/
bun create kimi-toolchain my-app
```
