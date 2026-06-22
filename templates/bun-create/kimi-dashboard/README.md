---
title: "README"
tags: [templates]
category: meta
status: draft
priority: medium
---
# {{name}}

Bun-native HTTP dashboard with a handler directory pattern, artifact awareness, and zero runtime dependencies. Scaffolded from [kimi-toolchain](https://github.com/brendadeeznuts1111/kimi-toolchain).

Use this template when you want a small, readable server you own end-to-end. For the full Bun API demo suite, see **Related dashboards** below.

## Create

```bash
# Local template (from a kimi-toolchain clone)
export BUN_CREATE_DIR=~/kimi-toolchain/templates/bun-create
bun create kimi-dashboard my-dashboard
cd my-dashboard
```

## Quickstart

```bash
bun install
bun run dev
# Open http://localhost:5678
```

Production-style (no watch):

```bash
bun run start
# or: PORT=8080 bun run start
```

## Project layout

```
my-dashboard/
├── package.json
├── tsconfig.json
├── bunfig.toml
├── README.md
└── src/
    ├── index.ts              # Bun.serve + route table
    ├── lib/
    │   ├── response.ts       # json() / text() helpers
    │   └── artifact-store.ts # saveArtifact(), listArtifacts(), latestArtifact()
    ├── handlers/
    │   ├── health.ts         # runtime probe
    │   ├── inspect.ts        # Bun.inspect demo
    │   ├── env.ts            # env vars + bunfig parse
    │   ├── crypto.ts         # CryptoHasher + UUID v7
    │   ├── crypto-sha3.ts    # SHA3 via WebCrypto + node:crypto (1.3.13+)
    │   └── file.ts           # Bun.serve() Range request support (1.3.13+)
    └── docs/
        └── extend.md         # how to add handlers and copy from examples
```

## API routes

| Route          | Description                                                     |
| -------------- | --------------------------------------------------------------- |
| `/`            | Plain-text banner (`{{name}} — Bun Dashboard`)                  |
| `/health`      | Runtime info: Bun version/revision, pid, uptime, memory         |
| `/inspect`     | `Bun.inspect()` — default vs configured depth/sort/compact      |
| `/env`         | Sample env vars + `Bun.TOML.parse()` of `./bunfig.toml`         |
| `/crypto`      | `Bun.CryptoHasher` (sha256), `Bun.randomUUIDv7()`, nanoseconds  |
| `/crypto-sha3` | SHA3-256 via WebCrypto + node:crypto (Bun 1.3.13+)              |
| `/file`        | File-backed response with automatic Range support (Bun 1.3.13+) |

All JSON routes return `content-type: application/json; charset=utf-8`.

## Configuration

| Variable | Default | Effect                  |
| -------- | ------- | ----------------------- |
| `PORT`   | `5678`  | `Bun.serve` listen port |

## Extend

1. Add a handler module, e.g. `src/handlers/password.ts`:

   ```ts
   import { json } from "../lib/response.ts";
   export async function apiPassword(): Promise<Response> {
     const hash = await Bun.password.hash("demo", { algorithm: "argon2id" });
     return json({ hash });
   }
   ```

2. Import it in `src/index.ts` and add it to the `HANDLERS` record.

3. Copy more endpoints from `examples/dashboard/src/handlers/`. See `docs/extend.md` for the full catalog.

## Artifacts

```ts
import { saveArtifact } from "./lib/artifact-store.ts";
await saveArtifact("var/artifacts", "health", {
  tool: "health-check",
  level: "info",
  timestamp: new Date().toISOString(),
  payload: { ok: true },
});
```

Artifacts are saved in `var/artifacts/<gate>/<timestamp>.json` with optional lineage metadata.

## Related dashboards

| Surface                | Where                                   | What you get                                                  |
| ---------------------- | --------------------------------------- | ------------------------------------------------------------- |
| **This template**      | `templates/bun-create/kimi-dashboard/`  | Handler directory, artifact store, zero deps                  |
| **Feature dashboard**  | `examples/dashboard/` in kimi-toolchain | 40+ `/api/*` handlers (perf harness, SQLite, image, shell, …) |
| **Toolchain CLI**      | `kimi-dashboard` or `bun run dashboard` | Runs `examples/dashboard` from the repo root                  |
| **Herdr orchestrator** | `templates/herdr-dashboard.*`           | Multi-tab ops UI (agents, artifacts, lineage, sessions)       |

## Toolchain docs

- [TEMPLATES.md](https://github.com/brendadeeznuts1111/kimi-toolchain/blob/main/TEMPLATES.md) — bun-create vs scaffold families
- [docs/references/dashboard-thumbnails.md](https://github.com/brendadeeznuts1111/kimi-toolchain/blob/main/docs/references/dashboard-thumbnails.md) — WebView → `Bun.Image` thumbnails (Herdr orchestrator)
