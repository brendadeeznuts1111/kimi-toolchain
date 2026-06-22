---
title: Secrets Service Registry
tags: [secrets, identity, bun-secrets, policy, registry]
category: identity
status: active
last-reviewed: 2026-06-21
---

# Secrets Service Registry

<!-- #find: secrets-registry #find: bun-secrets-services #find: consumer-names -->

Single source of truth for all `Bun.secrets` service names, their purposes,
allowed consumers, and secret names in this monorepo.

> **Rule:** Every entry here must have a matching entry in `secrets-policy.json5`.
> The CI check `bun run check:secrets-registry` enforces this.

---

## Scope: SecretsManager vs raw Bun.secrets

`SecretsManager` builds on `Bun.secrets`, which is intended for local development
tools and CLI applications. It adds policy enforcement, audit logging, and
structured naming on top of the raw keychain API.

| Use case | Use | Why |
|---|---|---|
| CLI tools, local dev scripts, one-off access | `Bun.secrets` directly | No policy overhead, simplest path |
| Production services, anything with rotation requirements | `SecretsManager` | Policy enforcement, audit trail, consumer checks |
| Effect-TS pipelines | `Secrets` context tag + `SecretsLive` layer | Dependency injection, testability |

**Guideline:** Start with `Bun.secrets` for simple cases. Graduate to
`SecretsManager` when you need audit trails, consumer restrictions, or rotation
reminders. The `SecretsTest` layer makes migration painless.

---

## Pre-Child-Process Secret Resolution

CLI tools that spawn child processes (`bun install`, `bun outdated`, `bun publish`,
`git clone`, etc.) must resolve dev secrets from `Bun.secrets` into `process.env`
**before** spawning. This ensures child processes inherit auth tokens without
each tool reimplementing keychain lookups.

### Helpers (`src/lib/bun-utils.ts`)

| Helper | Resolves | Populates |
|---|---|---|
| `resolveGithubEnv()` | `GITHUB_TOKEN`, `GITHUB_API_DOMAIN` | `process.env.GITHUB_TOKEN`, `GITHUB_API_DOMAIN` |
| `resolveNpmEnv()` | `NPM_TOKEN` | `process.env.NPM_TOKEN`, `NPM_CONFIG_TOKEN` |
| `resolveR2Env()` | `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | `process.env.R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` |
| `resolveDiscordEnv()` | `DISCORD_WEBHOOK_URL` | `process.env.DISCORD_WEBHOOK_URL` |
| `resolveTelegramEnv()` | `TELEGRAM_BOT_TOKEN` | `process.env.TELEGRAM_BOT_TOKEN` |
| `resolveDevSecrets()` | All of the above (parallel) | All of the above |

### Rules

1. **Env wins over keychain** — existing `process.env` values are never overwritten.
2. **Call early** — resolve before any `Bun.spawn` or `$` template call.
3. **`--no-secrets` flag** — `kimi-new` supports `--no-secrets` to skip resolution when CI already sets env vars.
4. **`--secrets-dry-run` flag** — `kimi-new --secrets-dry-run` resolves all secrets and prints status (✅/❌) without scaffolding.
5. **Never log resolved values** — the helpers return the resolved values for convenience, but they should not be printed.
6. **Debug logging** — set `KIMI_DEBUG_SECRETS=1` to see which env vars were resolved from env vs keychain vs missing (no values logged).
7. **`resolveSecrets` option** — `runCliExit()` accepts `{ resolveSecrets: true }` to automatically resolve dev secrets before the CLI program runs. New CLIs that spawn should use this instead of manual `await resolveDevSecrets()`.

### CLIs that call `resolveDevSecrets()`

- `kimi-new` — before `bun init` + `kimi-fix` (skippable with `--no-secrets`, debuggable with `--secrets-dry-run`)
- `kimi-fix` — before `git init` and tool delegation
- `kimi-release` — before delegating to `kimi-governance` (which spawns `bun install`)
- `kimi-doctor` — before `bun run sync` and other spawned tools
- `kimi-governance` — before `bun install --ignore-scripts`
- `kimi-guardian` — before `bun outdated`

### CI Enforcement

`scripts/check-secret-resolution.ts` scans all `src/bin/*.ts` files and flags any that spawn child processes without calling a resolver. Exempt list is maintained in the script for bins that only do local file I/O. Run via `bun run check:secret-resolution`.

---

## Service Registry

| Service Name | Constant | Purpose | Primary Consumers | Secret Names |
|---|---|---|---|---|
| `kimi-toolchain` | `Services.KIMI_TOOLCHAIN` | Cloudflare/infra credentials (legacy, pre-reverse-domain) | `kimi-cloudflare-access`, `kimi-doctor` | `cloudflare-account-id`, `cloudflare-api-token` |
| `com.herdr.cli` | `Services.CLI` | CLI tools (`kimi-fix`, `kimi-doctor`, `kimi-guardian`, `kimi-secrets`) | `kimi-fix`, `kimi-doctor` | `github-token`, `github-api-domain`, `npm-token`, `bet365-api-key`, `r2-access-key-id`, `r2-secret-access-key`, `discord-webhook-url`, `telegram-bot-token` |
| `com.herdr.dashboard` | `Services.DASHBOARD` | Main web dashboard, HTTP server, auth layer | `herdr-server`, `webhook:named`, `identity-service` | `csrf-secret`, `jwt-secret`, `master-key` |
| `com.herdr.security` | `Services.SECURITY` | Security scanner and vulnerability pipeline | `bun-install` | `scanner-api-key` |

---

## Consumer Registry

| Consumer Name | Constant | Role |
|---|---|---|
| `kimi-cloudflare-access` | `Consumers.CLOUDFLARE_ACCESS` | kimi-cloudflare-access CLI — reads Cloudflare credentials |
| `kimi-doctor` | `Consumers.KIMI_DOCTOR` | kimi-doctor diagnostic tool — reads all infra/CLI secrets |
| `kimi-fix` | `Consumers.KIMI_FIX` | kimi-fix automated repair — reads CLI tokens |
| `herdr-server` | `Consumers.HERDR_SERVER` | Main herdr HTTP server process |
| `webhook:named` | `Consumers.WEBHOOK_NAMED` | Named webhook handlers in the dashboard |
| `identity-service` | `Consumers.IDENTITY_SERVICE` | Identity service (JWT signing, CSRF generation, session) |
| `bun-install` | `Consumers.SCANNER_PIPELINE` | Security scanning pipeline |

---

## Naming Rules

### Service names
- Format: `<top-level>.<org>.<component>[.<sub-component>]` (UTI / reverse-domain style, following [Bun's guidance](https://bun.com/docs/api/secrets) for `Bun.secrets` service naming)
- Allowed top-levels: `com`, `org`, `io`, `net` — prefer `com`
- **Never** include environment (`prod`, `dev`) or version (`v2`) in the service name
- Use the `environments` field in `secrets-policy.json5` for per-env variations

### Consumer names
- Lowercase kebab-case
- Describes the **role**, not the component (`"identity-service"` not `"identity"`)
- No org prefix needed — it is implied

### Guardrails

| ❌ Don't | ✅ Do |
|---|---|
| `service: "api"` | `service: "com.herdr.dashboard"` |
| `service: "com.herdr.cli.prod"` | Use `environments` in policy |
| `service: "com.herdr.dashboard.v2"` | New secret name, same service |
| `consumer: "security"` | `consumer: "scanner-pipeline"` |
| Inline string literals | Use `Services.*` and `Consumers.*` constants |

---

## Adding a New Secret

1. Add the service + secret name here under Service Registry.
2. Add to `secrets-policy.json5` with `allowedConsumers`, `rotationDays`, `version: 1`.
3. Add a typed `SecretKey` variant to `src/lib/secrets-types.ts`.
4. Add a `SecretKeys.*` entry to `src/lib/secrets-constants.ts`.
5. Add the secret to the `kimi-secrets` init template in `src/bin/kimi-secrets.ts`.
6. Add a resolver function in `src/lib/bun-utils.ts` if the secret needs env injection.
7. Run `bun run check:secrets-registry` to verify consistency (includes init template sync check).

## Usage Examples

### Resolve secrets before spawning a child process

```typescript
import { resolveDevSecrets } from "../lib/bun-utils.ts";

async function main() {
  const resolution = await resolveDevSecrets();
  // process.env now has all available secrets populated

  // Spawn child process with secrets in env
  const proc = Bun.spawn(["bun", "install"], { stdout: "pipe" });
  await proc.exited;
}
```

### Debug secret resolution

```bash
# See which secrets came from env vs keychain vs missing
KIMI_DEBUG_SECRETS=1 bun run src/bin/kimi-new.ts --secrets-dry-run
```

Output:
```
  ❌ GITHUB_TOKEN ← missing
  🔑 NPM_TOKEN ← keychain
  ── resolved 3/7 (2 env, 1 keychain, 4 missing)
  ⚠ GITHUB_TOKEN is missing — set it via env var or run `kimi-secrets init` to store in keychain
Secret resolution status:
  GITHUB_TOKEN           ❌ missing
  NPM_TOKEN              🔑 keychain
  ── resolved 3/7 (2 env, 1 keychain, 4 missing)
```

### Use resolveSecrets option with runCliExit

```typescript
import { runCliExit } from "../lib/effect/cli-runtime.ts";

const exitCode = await runCliExit(
  program,
  { toolName: "my-tool", resolveSecrets: true }
);
```

### Export scanner results as SARIF

```typescript
import { runScannerPipeline, scannerResultToSarif } from "../lib/scanner-pipeline.ts";

const result = await runScannerPipeline({ dependencies });
const sarif = scannerResultToSarif(result);
await Bun.write("scan-results.sarif", JSON.stringify(sarif, null, 2));
```

### Build-time secrets metadata via macros

```typescript
import { getSecretKeysMetadata } from "../lib/secrets-metadata-macros.ts" with { type: "macro" };

const metadata = getSecretKeysMetadata(); // inlined as static JSON at build time
```

## Migrating a Service Name

1. Add the new service name to this registry and to `secrets-policy.json5`.
2. Write a migration script using `Bun.secrets.set()` to copy values.
3. Update all code to use the new `Services.*` constant.
4. Add `status: deprecated` comment to the old service in the policy.
5. Remove after one release cycle.

---

## Related

- [../../secrets-policy.json5](../../secrets-policy.json5) — Runtime policy (rotation, consumers, expiry)
- [../../src/lib/secrets-constants.ts](../../src/lib/secrets-constants.ts) — TypeScript constants
- [../../src/lib/secrets-types.ts](../../src/lib/secrets-types.ts) — Typed `SecretKey` union
- [../../src/lib/secrets-manager.ts](../../src/lib/secrets-manager.ts) — SecretsManager implementation
- [../../INDEX.md](../../INDEX.md) — Documentation index
