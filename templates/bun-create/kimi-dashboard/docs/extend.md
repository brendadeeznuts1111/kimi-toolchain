---
title: "Extend"
tags: [templates]
category: meta
status: draft
priority: medium
---
# {{name}} — Extending the Dashboard

## Handler Directory Pattern

Each route lives in its own file under `src/handlers/`. This makes:

- Adding a route = writing a new file + importing it in `src/index.ts`
- Testing a route = importing the handler directly in a test
- Reusing a route = copying the file to another project

## Add a new route

1. Create `src/handlers/password.ts`:

```ts
import { json } from "../lib/response.ts";

export async function apiPassword(): Promise<Response> {
  const hash = await Bun.password.hash("demo", { algorithm: "argon2id" });
  return json({ hash });
}
```

2. Import and register in `src/index.ts`:

```ts
import * as password from "./handlers/password.ts";

const HANDLERS = {
  "/password": password.apiPassword,
  // ...existing handlers
};
```

## Copy more from the full example

The `kimi-toolchain` repo has 40+ handlers covering:

| Handler          | Bun API                                    | Bun Version | Path in repo                                     |
| ---------------- | ------------------------------------------ | ----------- | ------------------------------------------------ |
| `password.ts`    | `Bun.password`                             | ≥1.2        | `examples/dashboard/src/handlers/password.ts`    |
| `sqlite.ts`      | `bun:sqlite`                               | ≥1.2        | `examples/dashboard/src/handlers/sqlite.ts`      |
| `markdown.ts`    | `Bun.markdown.html()`                      | ≥1.2        | `examples/dashboard/src/handlers/markdown.ts`    |
| `glob.ts`        | `Bun.Glob`                                 | ≥1.2        | `examples/dashboard/src/handlers/glob.ts`        |
| `shell.ts`       | `Bun.Shell ($)`                            | ≥1.2        | `examples/dashboard/src/handlers/shell.ts`       |
| `image.ts`       | `Bun.Image`                                | ≥1.2        | `examples/dashboard/src/handlers/image.ts`       |
| `os-info.ts`     | `node:os`                                  | ≥1.2        | `examples/dashboard/src/handlers/os-info.ts`     |
| `file.ts`        | `Bun.serve()` Range requests, `Bun.file()` | ≥1.3.13     | `examples/dashboard/src/handlers/file.ts`        |
| `crypto-sha3.ts` | WebCrypto SHA3 + `node:crypto` SHA3/HMAC   | ≥1.3.13     | `examples/dashboard/src/handlers/crypto-sha3.ts` |

```bash
cd ~/kimi-toolchain/examples/dashboard
cat src/handlers/password.ts    # copy to your project
```

## Artifacts

The template ships with `src/lib/artifact-store.ts` for saving JSON envelopes:

```ts
import { saveArtifact } from "./lib/artifact-store.ts";

await saveArtifact("var/artifacts", "health", {
  tool: "health-check",
  level: "info",
  timestamp: new Date().toISOString(),
  payload: { ok: true },
});
```

Artifacts land in `var/artifacts/<gate>/<timestamp>.json` and are compatible with `kimi-doctor --artifacts-lineage`.

## Type checking

```bash
bun run typecheck   # tsc --noEmit
```

## Related

- [examples/dashboard/](../../../examples/dashboard/) — Full 65-card showcase
- [examples/dashboard-urls.md](../../../examples/dashboard-urls.md) — Port, protocol, and URLPattern reference
- [Bun v1.3.13 release notes](https://bun.com/blog/bun-v1.3.13) — Range requests, SHA3, isolated linker, test parallelism
