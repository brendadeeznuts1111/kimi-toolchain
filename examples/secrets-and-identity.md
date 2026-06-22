# Secrets & Identity — Usage Examples

This document shows how to use the secrets management system, identity layer (JWT, CSRF, sessions), and the secure install scanner pipeline.

## Secrets Management

### Initialize a Policy

```bash
kimi-secrets init
```

Creates `secrets-policy.json5` in the project root:

```json5
{
  $schema: "v1",
  "kimi-toolchain": {
    "cloudflare-api-token": {
      allowedConsumers: ["kimi-cloudflare-access"],
      rotationDays: 90,
      lastRotated: null,
      version: 1,
    },
  },
}
```

### Store and Retrieve Secrets

```bash
# Store a secret (prompts for value)
kimi-secrets set kimi-toolchain cloudflare-api-token

# Retrieve (masked by default)
kimi-secrets get kimi-toolchain cloudflare-api-token
# Output: ••••••••••••ab

# Retrieve unmasked
kimi-secrets get kimi-toolchain cloudflare-api-token --unmask

# List all secrets with status
kimi-secrets list
#   ✓ kimi-toolchain:cloudflare-api-token — present
#   ✗ kimi-toolchain:scanner-api-key — missing
```

### Health Check

```bash
kimi-secrets check
# All secrets healthy

# JSON output for CI
kimi-secrets check --json
```

### Rotate and Audit

```bash
# Rotate a secret
kimi-secrets rotate kimi-toolchain cloudflare-api-token

# View audit trail
kimi-secrets audit
kimi-secrets audit --service kimi-toolchain
```

### Programmatic Usage (Effect)

```typescript
import { Effect } from "effect";
import { SecretsManager } from "./src/lib/secrets-manager.ts";

const manager = new SecretsManager({ projectRoot: Bun.cwd });

// Get a secret
const program = Effect.gen(function* () {
  const token = yield* manager.get(
    { service: "kimi-toolchain", name: "cloudflare-api-token" },
    "my-app"
  );
  return token;
});

const result = await Effect.runPromise(program);
```

### Backends

The `SecretsManager` supports pluggable backends:

- **OS Keychain** (default) — uses `security` on macOS, `secret-tool` on Linux
- **Environment variables** — reads from `process.env` with `SERVICE_NAME` → `SERVICE_NAME` mapping
- **File-based** — stores in `.kimi-secrets/` (for development only)
- **Custom** — implement the `SecretsBackend` interface

```typescript
import type { SecretsBackend } from "./src/lib/secrets-types.ts";

const customBackend: SecretsBackend = {
  async get({ service, name }) { /* ... */ },
  async set({ service, name, value }) { /* ... */ },
  async delete({ service, name }) { /* ... */ },
};
```

## Identity Layer

### JWT Authentication

```typescript
import { Identity, IdentityTest } from "./src/lib/effect/identity-service.ts";
import { Effect } from "effect";

const layer = IdentityTest({
  jwtSecret: "your-secret-key",
  csrfSecret: "your-csrf-secret",
});

// Sign a JWT
const signProgram = Effect.gen(function* () {
  const id = yield* Identity;
  const token = yield* id.signJWT(
    { userId: "user-123", role: "admin" },
    { expiresIn: 3600 }
  );
  return token;
});

const token = await Effect.runPromise(Effect.provide(layer)(signProgram));

// Verify a JWT
const verifyProgram = Effect.gen(function* () {
  const id = yield* Identity;
  const payload = yield* id.verifyJWT(token);
  return payload;
});

const payload = await Effect.runPromise(Effect.provide(layer)(verifyProgram));
```

### CSRF Protection

```typescript
const csrfProgram = Effect.gen(function* () {
  const id = yield* Identity;
  const token = yield* id.generateCsrfToken();
  // Store token in session, include in forms as hidden field
  return token;
});

// Verify CSRF token on POST requests
const verifyCsrf = Effect.gen(function* () {
  const id = yield* Identity;
  yield* id.verifyCsrfToken(sessionToken, formToken);
});
```

### Session Management

```typescript
const sessionProgram = Effect.gen(function* () {
  const id = yield* Identity;
  const cookie = yield* id.createSession("user-123", {
    expiresIn: 86400, // 24 hours
  });
  // Set cookie in HTTP response
  return cookie;
});
```

### Full HTTP Server Example

Run the standalone example:

```bash
bun run src/lib/identity-usage-example.ts
# Identity example server running on http://localhost:3000
```

Endpoints:

| Method | Path       | Description                    |
| ------ | ---------- | ------------------------------ |
| POST   | `/login`   | Authenticate and create session |
| POST   | `/logout`  | Destroy session                |
| GET    | `/me`      | Get current user (requires auth) |
| POST   | `/data`    | Submit data (requires CSRF)    |
| GET    | `/token`   | Get JWT for API access         |

## Scanner Pipeline

### Automatic Dependency Discovery

```typescript
import { discoverTargets } from "./src/lib/scanner-pipeline.ts";

// Discover all dependencies in the project
const deps = await discoverTargets(Bun.cwd);
// [{ name: "effect", current: "3.21.4", range: "^3.0.0" }, ...]

// Include workspace packages
const allDeps = await discoverTargets(Bun.cwd, { includeWorkspaces: true });
```

### Run the Full Pipeline

```typescript
import { runScannerPipeline } from "./src/lib/scanner-pipeline.ts";

const result = await runScannerPipeline({
  dependencies: deps,
  projectRoot: Bun.cwd,
  patch: true,        // auto-patch where possible
  dryRun: false,      // actually apply patches
  minSeverity: "high",
});

console.log(`Scanned: ${result.scanned}`);
console.log(`Vulnerabilities: ${result.vulnerabilities}`);
console.log(`Patched: ${result.patched}`);
console.log(`Manual review: ${result.manual}`);
```

### Secure Install

```bash
# Install with pre-flight secret check + CVE scanning
bun run src/bin/install-secure.ts install

# With auto-patching
bun run src/bin/install-secure.ts install --patch

# Dry run (validate only)
bun run src/bin/install-secure.ts install --dry-run
```

## Testing

All modules have comprehensive unit tests:

```bash
# Run all tests
bun test

# Run specific test suites
bun test test/secrets-manager.unit.test.ts
bun test test/identity-service.unit.test.ts
bun test test/scanner-pipeline.unit.test.ts
bun test test/macros.unit.test.ts
```
