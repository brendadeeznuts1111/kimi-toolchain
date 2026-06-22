# Error domain registry

Single source of truth: `src/lib/error-domains-constants.ts`.

Colored formatting: `src/lib/error-format.ts` (`Bun.color` + severity tints).

Lint: `bun run scripts/lint-error-registry.ts` (wired into `bun run lint`).

**Note:** `taxonomyId` (snake_case, `error-taxonomy.yml`) classifies failures for the ledger. `domain` (reverse-domain) labels human/structured CLI output. They complement each other — see `TAXONOMY_DOMAIN_HINTS` for optional mapping.

## Domains

| Id                 | Domain                                | Default severity | Color          | Description                                                      |
| ------------------ | ------------------------------------- | ---------------- | -------------- | ---------------------------------------------------------------- |
| `cli`              | `com.kimi.toolchain.cli`              | error            | deepskyblue    | CLI contract, argv parsing, and user-facing command errors.      |
| `gates`            | `com.kimi.toolchain.gates`            | error            | darkorange     | Pre-commit, pre-push, and quality gate failures.                 |
| `governance`       | `com.kimi.toolchain.governance`       | warn             | mediumpurple   | R-Score, preflight auto-fix, and governance policy errors.       |
| `identity-jwt`     | `com.kimi.toolchain.identity.jwt`     | error            | lightseagreen  | JWT sign, verify, revoke, and token lifecycle errors.            |
| `identity-session` | `com.kimi.toolchain.identity.session` | error            | teal           | Session, CSRF, and agent context identity errors.                |
| `scanner`          | `com.kimi.toolchain.scanner`          | error            | limegreen      | Vulnerability and supply-chain scanner errors.                   |
| `secrets`          | `com.kimi.toolchain.secrets`          | error            | gold           | Bun.secrets, credential policy, and secret resolution errors.    |
| `doctor`           | `com.kimi.toolchain.doctor`           | warn             | cornflowerblue | kimi-doctor checks, adapters, and health probe failures.         |
| `perf`             | `com.kimi.toolchain.perf`             | warn             | hotpink        | Perf harness, benchmark gates, and install bench errors.         |
| `bundle`           | `com.kimi.toolchain.bundle`           | error            | slategray      | bun build --compile, bundle analysis, and compile-target errors. |
| `http`             | `com.kimi.toolchain.http`             | error            | orangered      | Bun.serve fetch handler and error-callback failures.             |

## Usage

```ts
import { formatErrorColored, formatError } from "../lib/error-format.ts";

console.error(
  formatErrorColored({
    domain: "identity-jwt",
    code: "jwt_expired",
    message: "token expired",
    taxonomyId: "auth_failure",
  })
);
```

```ts
import { Logger } from "../lib/logger.ts";

logger.errorFormatted({
  domain: "gates",
  severity: "error",
  message: "effect-gates failed",
  taxonomyId: "effect_gates_failure",
});
```

Disable color: `NO_COLOR=1` or `KIMI_NO_COLOR=1`.
