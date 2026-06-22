# Scanner Pipeline Specification

## Overview

The scanner pipeline integrates vulnerability detection, version evaluation, and automated patching into the secure install flow. It bridges `kimi-guardian`'s existing CVE scanning (OSV API), `Bun.semver` for version comparison, `Bun.patch` for persistent fixes, and `SecretsManager` for pre-flight credential validation.

## Pipeline Phases

```
┌─────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ Preflight│ → │ Scan     │ → │ Evaluate │ → │ Patch    │ → │ Audit    │
│ (secrets)│    │ (OSV API)│    │ (semver) │    │ (bun pm)│    │ (NDJSON) │
└─────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘
```

### Phase 1: Pre-flight (`SecretsManager.check()`)

- **Source**: `install-secure.ts` → `runPreflight()`
- Validates all registered secrets are present and non-stale
- If `scanner-api-key` is missing → **abort with exit code 10**
- If any secret is stale → **warn but continue** (stale secrets still function)
- If `--skip-preflight` flag is passed → skip entirely

### Phase 2: Scan (OSV API)

- **Source**: `kimi-guardian.ts` → `checkCVEs()` (already implemented)
- Queries `https://api.osv.dev/v1/query` for each dependency
- Rate-limited to 10 deps per run (existing behavior)
- **Input**: `package.json` dependencies + `bun.lock` resolved versions
- **Output**: `Array<{ name, cveId, severity }>`

**Error handling**:

- Network failure → skip dep, log warning, continue
- API rate limit (429) → exponential backoff (max 3 retries)
- Invalid response → skip dep, log warning

### Phase 3: Evaluate (`Bun.semver`)

For each CVE found, determine the fix strategy using `Bun.semver`:

```
Bun.semver.satisfies(fixedVersion, currentRange) → can we upgrade within range?
Bun.semver.order(fixedVersion, currentVersion)   → is the fix newer?
```

**Decision tree**:

```
For each CVE:
  ├─ Does a fixed version exist in the advisory?
  │   ├─ YES → Is fixedVersion within current semver range?
  │   │   ├─ YES → Strategy: "upgrade" (bun update <pkg>)
  │   │   └─ NO  → Is a patch available?
  │   │       ├─ YES → Strategy: "patch" (bun patch <pkg>)
  │   │       └─ NO  → Strategy: "manual" (requires human review)
  │   └─ NO  → Strategy: "manual" (no known fix)
```

**Severity thresholds**:

| Severity              | Action        | Auto-patch?            |
| --------------------- | ------------- | ---------------------- |
| CRITICAL (CVSS ≥ 9.0) | Block install | Yes, if `--patch` flag |
| HIGH (CVSS 7.0–8.9)   | Warn          | Yes, if `--patch` flag |
| MEDIUM (CVSS 4.0–6.9) | Warn          | No                     |
| LOW (CVSS < 4.0)      | Info          | No                     |
| unknown               | Warn          | No                     |

### Phase 4: Patch (`Bun.patch`)

When `--patch` flag is set and strategy is "patch" or "upgrade":

**Upgrade path** (`bun update <pkg>`):

1. Run `bun update <pkg>@<fixedVersion>`
2. Verify lockfile updated
3. Re-scan to confirm CVE resolved
4. Record audit entry

**Patch path** (`bun patch`):

1. `bun patch <pkg>@<version>` — prepare package for editing
2. Apply minimal fix (if known patch exists in `patches/` directory)
3. `bun patch --commit <pkg>` — generate `.patch` file
4. Verify `patchedDependencies` updated in `package.json`
5. Re-scan to confirm CVE resolved
6. Record audit entry

**Safety constraints**:

- Never auto-patch more than 5 packages in a single run
- Always create a git commit after patching (unless `--no-commit`)
- If patching fails, rollback to pre-patch state
- Patches are stored in `patches/` directory (Bun default)

### Phase 5: Audit

- All scan results, evaluations, and patch actions are recorded to `secrets-audit.ndjson`
- Uses `SecretsManager.recordAudit()` (fire-and-forget)
- Audit records include: `action: "check"`, `consumer: "bun-install"`, CVE IDs, severity, strategy used

## Exit Codes

| Code | Meaning                                                  |
| ---- | -------------------------------------------------------- |
| 0    | Success — no vulnerabilities found                       |
| 1    | Generic error                                            |
| 10   | Pre-flight failed — required secrets missing             |
| 20   | Vulnerabilities found, no auto-patch (`--patch` not set) |
| 21   | Vulnerabilities found, partially patched                 |
| 22   | Vulnerabilities found, patching failed                   |
| 30   | Network error during scan (retries exhausted)            |

## CLI Flags

```
kimi install-secure [options]

Options:
  --patch              Auto-patch vulnerabilities where possible
  --no-commit          Don't create a git commit after patching
  --skip-preflight     Skip SecretsManager.check()
  --dry-run            Validate only, don't modify anything
  --severity <level>   Minimum severity to act on (critical|high|medium|low)
  --max-patches <n>    Maximum packages to patch per run (default: 5)
  --mode <mode>        Install mode: install|ci|add|update
  --args <args...>     Extra args to pass to bun install
```

## Integration Points

### Dependency Discovery (`Bun.Glob`)

The `discoverTargets()` function in `scanner-pipeline.ts` automates dependency discovery using `Bun.Glob`:

```typescript
import { discoverTargets } from "./scanner-pipeline.ts";

// Default: scan root package.json
const deps = await discoverTargets(Bun.cwd);

// Include workspace packages
const deps = await discoverTargets(Bun.cwd, { includeWorkspaces: true });

// Exclude devDependencies
const deps = await discoverTargets(Bun.cwd, { includeDev: false });
```

**How it works:**

1. Always includes the root `package.json`
2. When `includeWorkspaces` is true, uses `new Bun.Glob("**/package.json")` to find all workspace packages (excluding `node_modules`)
3. Parses each `package.json`, collecting `dependencies` and optionally `devDependencies`
4. Deduplicates by package name
5. Strips range prefixes (`^`, `~`, `>=`, `<=`) from version strings

**Output:** `Array<DependencyInfo>` where each entry has `{ name, current, range }`.

### Existing code reuse:

- **`kimi-guardian.ts`** → `checkCVEs()` — OSV API scanning
- **`trusted-dependencies.ts`** → `scanUntrustedInstallScripts()` — lifecycle script validation
- **`bunfig-policy.ts`** → `bunfigPolicyGate()` — bunfig.toml compliance gate
- **`install-secure.ts`** → `runInstallSecure()` — pipeline orchestrator
- **`SecretsManager`** → `check()`, `get()` — credential validation and injection

### New code:

- `evaluateVulnerability()` — uses `Bun.semver` to determine fix strategy
- `applyPatch()` — wraps `bun patch` / `bun update` commands
- `runScannerPipeline()` — orchestrates phases 2–4

## `Bun.semver` Usage

```typescript
import { semver } from "bun";

// Check if fixed version is within current range
semver.satisfies("1.2.1", "^1.2.0"); // true → upgrade within range

// Compare versions
semver.order("1.2.1", "1.2.0"); // 1 → fixed is newer

// Sort advisories by fixed version
advisories.sort((a, b) => semver.order(a.fixedVersion, b.fixedVersion));
```

## `Bun.patch` Usage

```typescript
// Step 1: Prepare
await Bun.spawn(["bun", "patch", `${pkg}@${version}`]).exited;

// Step 2: Apply fix (manual or from known patch file)
// ... edit node_modules/<pkg> files ...

// Step 3: Commit
await Bun.spawn(["bun", "patch", "--commit", `${pkg}@${version}`]).exited;

// package.json now contains:
// "patchedDependencies": { "react@17.0.2": "patches/react@17.0.2.patch" }
```

## SecretsManager Integration

The `scanner-api-key` secret (service: `com.herdr.security`, name: `scanner-api-key`) is used for authenticated access to premium vulnerability databases. The OSV API is free and unauthenticated, but future integrations (Snyk, GitHub Advisory Database) may require API keys.

**Policy entry** (from `secrets-policy.json5`):

```json5
"com.herdr.security": {
  "scanner-api-key": {
    allowedConsumers: ["bun-install"],
    rotationDays: 365,
    lastRotated: null,
    version: 1,
  },
}
```

**Injection**: When `requiredSecrets` includes the scanner API key, `resolveSecretsForEnv()` converts it to `SCANNER_API_KEY` env var for the scan subprocess.
