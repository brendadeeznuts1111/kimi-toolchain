# Feature flags registry

Single source of truth for flag definitions: `src/lib/feature-flags-constants.ts`.

Runtime helpers: `src/lib/feature-flags.ts`. Bundle flag constants: `src/lib/feature-flags-constants.ts`.

Lint: `bun run scripts/lint-registry.ts --feature` (wired into `bun run lint`).

## Bundle compile-time flags

Enable at bundle time with `bun build --compile --feature=FLAG …`. Eliminated from release binaries when off.

| Id               | Kind   | Key        | Domain                      | Default | Description                                                                   |
| ---------------- | ------ | ---------- | --------------------------- | ------- | ----------------------------------------------------------------------------- |
| `debug-build`    | bundle | `DEBUG`    | `com.kimi.toolchain.bundle` | false   | Verbose reference inspect/generate logging — eliminated from release bundles. |
| `online-build`   | bundle | `ONLINE`   | `com.kimi.toolchain.bundle` | false   | Network-backed reference lint — eliminated from offline bundles.              |
| `mock-api-build` | bundle | `MOCK_API` | `com.kimi.toolchain.bundle` | false   | Mock external APIs in test/agent bundles.                                     |
| `premium-build`  | bundle | `PREMIUM`  | `com.kimi.toolchain.bundle` | false   | Premium-only reference lint paths.                                            |

## Runtime env flags

Set to `1` to activate. Escape hatches are for emergencies — document bypasses in commit messages.

| Id                          | Kind       | Key                              | Domain                          | Default | Description                                                            |
| --------------------------- | ---------- | -------------------------------- | ------------------------------- | ------- | ---------------------------------------------------------------------- |
| `skip-flaky-tests`          | env-escape | `KIMI_SKIP_FLAKY_TESTS`          | `com.kimi.toolchain.gates`      | false   | Tolerate sandbox/EPERM failures in test:fast and r-score during hooks. |
| `skip-constant-drift-gate`  | env-escape | `KIMI_SKIP_CONSTANT_DRIFT_GATE`  | `com.kimi.toolchain.gates`      | false   | Bypass constant-drift gate on pre-push.                                |
| `skip-effect-gates`         | env-escape | `KIMI_SKIP_EFFECT_GATES`         | `com.kimi.toolchain.gates`      | false   | Bypass Effect-discipline gate on pre-push.                             |
| `skip-perf-gates`           | env-escape | `KIMI_SKIP_PERF_GATES`           | `com.kimi.toolchain.gates`      | false   | Bypass perf-gate checks on pre-push.                                   |
| `skip-portal-gate`          | env-escape | `KIMI_SKIP_PORTAL_GATE`          | `com.kimi.toolchain.gates`      | false   | Bypass artifact portal convergence gate on pre-push.                   |
| `skip-governance-preflight` | env-escape | `KIMI_SKIP_GOVERNANCE_PREFLIGHT` | `com.kimi.toolchain.governance` | false   | Skip governance preflight auto-fix before R-Score.                     |
| `skip-network-probe`        | env-escape | `KIMI_SKIP_NETWORK_PROBE`        | `com.kimi.toolchain.testing`    | false   | Skip live MCP/network probe assertions in unit tests (CI/offline).     |
| `skip-release-blog-audit`   | env-escape | `KIMI_SKIP_RELEASE_BLOG_AUDIT`   | `com.kimi.toolchain.governance` | false   | Skip live historical blog audit in validate:release-ssot (offline).    |
| `perf-install`              | env-opt-in | `KIMI_PERF_INSTALL`              | `com.kimi.toolchain.perf`       | false   | Enable install benchmark on CI (opt-in).                               |

## Usage

```bash
# Bundle flag
bun build --compile --feature=DEBUG --feature=ONLINE scripts/inspect-references.ts

# Escape hatch (pre-push)
KIMI_SKIP_EFFECT_GATES=1 bun run check:fast

# Opt-in perf benchmark (dashboard harness)
KIMI_PERF_INSTALL=1 bun test examples/dashboard
```

```ts
import { isEnvEscapeEnabled } from "../lib/feature-flags.ts";

if (isEnvEscapeEnabled("KIMI_SKIP_EFFECT_GATES")) {
  // gate skipped
}
```
