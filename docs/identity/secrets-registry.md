# Secrets registry

Single source of truth for service/consumer names: `src/lib/secrets-constants.ts`.
Policy (rotation, consumers, storage tier): `secrets-policy.json5`.
Runtime enforcement: `src/lib/secrets-manager.ts`.

## Platform storage backends

`Bun.secrets` delegates to the OS credential store. Per-user isolation is consistent across platforms; Linux headless environments may fall back to plaintext env vars.

| Platform | Backend                                        | Fallback             | Security level |
| -------- | ---------------------------------------------- | -------------------- | -------------- |
| macOS    | Keychain                                       | None                 | High           |
| Windows  | Credential Manager (`CRED_PERSIST_ENTERPRISE`) | None                 | High           |
| Linux    | libsecret                                      | Env vars (plaintext) | Low            |

Detection: `detectStorageBackend()` in `src/lib/secrets-storage.ts`.
`SecretsManager.check()` emits a one-time warning when the active backend is `env-fallback`, and per-secret warnings when policy expects a secure tier.

### Env-fallback resolution

Secrets with `storageTier: "env-fallback"` are read from env when `Bun.secrets` returns null:

| Secret                                | Env vars (first match wins)                             |
| ------------------------------------- | ------------------------------------------------------- |
| `com.herdr.ci/github-token`           | `COM_HERDR_CI_GITHUB_TOKEN`, `GITHUB_TOKEN`, `GH_TOKEN` |
| `kimi-toolchain/cloudflare-api-token` | `CLOUDFLARE_API_TOKEN`                                  |
| `com.herdr.dashboard/jwt-secret`      | `JWT_SECRET`                                            |

Canonical key: `secretEnvKey(service, name)` in `src/lib/secrets-env.ts`.

### Diagnostics

```bash
kimi-doctor --agent-ready   # includes secrets:storage-backend + secrets:tier-mismatch
```

`SecretsManager.storageStatus()` returns backend, security level, mismatch counts, and warnings.
`check()` marks secure-tier secrets on env-fallback backend as `storage_mismatch`.
Audit records include `storageBackend` and `resolvedVia` (`bun.secrets` | `env`).

### Strict storage mode

Set `KIMI_SECRETS_STRICT_STORAGE=1` to block `get()` on secure-tier secrets when the active backend is `env-fallback` (fails with `storage_tier_mismatch`).

### Registry lint

```bash
bun run scripts/lint-secrets-registry.ts
```

Enforces `SecretKeys` ↔ `secrets-policy.json5` ↔ `docs/identity/secrets-registry.md` parity; CI service secrets must declare `storageTier: "env-fallback"`.

### Dashboard

`GET /api/secrets` returns storage status and presence (no values). Identity lane card: `card-secrets-storage`.
JWT/CSRF handlers use `serve-identity.ts` (IdentityLive + SecretsManager).

### CLI

```bash
kimi-secrets storage --json
kimi-secrets check
kimi-secrets list
kimi-secrets gate          # wired into bun run check
kimi-secrets rotate com.herdr.dashboard jwt-secret
```

### CI gate

`bun run secrets:gate` — fails on Linux env-fallback when secure-tier secrets lack policy opt-in.
Taxonomy: `secrets_storage_tier_mismatch` in `error-taxonomy.yml`.

## Storage tiers in policy

Optional `storageTier` on each `secrets-policy.json5` entry:

| Tier                 | When to use                                                  |
| -------------------- | ------------------------------------------------------------ |
| `keychain`           | macOS-only secrets (rare; usually omit for platform default) |
| `credential-manager` | Windows-only secrets (rare)                                  |
| `libsecret`          | Linux desktop with GNOME Keyring / KWallet                   |
| `env-fallback`       | CI/CD runners — explicit opt-in for plaintext env vars       |

Omit `storageTier` to use the platform-native secure default (`keychain` / `credential-manager` / `libsecret`).

### CI example

```json5
{
  "com.herdr.ci": {
    "github-token": {
      allowedConsumers: ["cli-tool"],
      storageTier: "env-fallback",
      rotationDays: 1,
    },
  },
}
```

## Services

| Constant                  | Service id            | Purpose                       |
| ------------------------- | --------------------- | ----------------------------- |
| `Services.KIMI_TOOLCHAIN` | `kimi-toolchain`      | Cloudflare Access credentials |
| `Services.CLI`            | `com.herdr.cli`       | CLI tool tokens               |
| `Services.DASHBOARD`      | `com.herdr.dashboard` | JWT, CSRF, master key         |
| `Services.SECURITY`       | `com.herdr.security`  | Scanner API key               |
| `Services.CI`             | `com.herdr.ci`        | CI-only short-lived tokens    |

## Verification

```bash
bun test test/secrets-manager.unit.test.ts test/secrets-storage.unit.test.ts
```
