/**
 * Error domain SSOT — reverse-domain namespaces for structured CLI logging.
 *
 * Registry: docs/identity/error-registry.md
 * Lint: scripts/lint-registry.ts --error
 *
 * Distinct from error-taxonomy.yml taxonomyId (snake_case failure classification).
 */

export type ErrorSeverity = "debug" | "info" | "warn" | "error" | "fatal";

export interface ErrorDomainDefinition {
  /** Stable kebab-case id — registry row key. */
  id: string;
  /** Reverse-domain namespace (searchable via rg). */
  domain: string;
  description: string;
  /** Default severity when callers omit one. */
  defaultSeverity: ErrorSeverity;
  /** Named color passed to Bun.color() for domain label tinting. */
  color: string;
}

export const ERROR_DOMAIN_DEFINITIONS = [
  {
    id: "cli",
    domain: "com.kimi.toolchain.cli",
    description: "CLI contract, argv parsing, and user-facing command errors.",
    defaultSeverity: "error",
    color: "deepskyblue",
  },
  {
    id: "gates",
    domain: "com.kimi.toolchain.gates",
    description: "Pre-commit, pre-push, and quality gate failures.",
    defaultSeverity: "error",
    color: "darkorange",
  },
  {
    id: "governance",
    domain: "com.kimi.toolchain.governance",
    description: "R-Score, preflight auto-fix, and governance policy errors.",
    defaultSeverity: "warn",
    color: "mediumpurple",
  },
  {
    id: "identity-jwt",
    domain: "com.kimi.toolchain.identity.jwt",
    description: "JWT sign, verify, revoke, and token lifecycle errors.",
    defaultSeverity: "error",
    color: "lightseagreen",
  },
  {
    id: "identity-session",
    domain: "com.kimi.toolchain.identity.session",
    description: "Session, CSRF, and agent context identity errors.",
    defaultSeverity: "error",
    color: "teal",
  },
  {
    id: "scanner",
    domain: "com.kimi.toolchain.scanner",
    description: "Vulnerability and supply-chain scanner errors.",
    defaultSeverity: "error",
    color: "limegreen",
  },
  {
    id: "secrets",
    domain: "com.kimi.toolchain.secrets",
    description: "Bun.secrets, credential policy, and secret resolution errors.",
    defaultSeverity: "error",
    color: "gold",
  },
  {
    id: "doctor",
    domain: "com.kimi.toolchain.doctor",
    description: "kimi-doctor checks, adapters, and health probe failures.",
    defaultSeverity: "warn",
    color: "cornflowerblue",
  },
  {
    id: "perf",
    domain: "com.kimi.toolchain.perf",
    description: "Perf harness, benchmark gates, and install bench errors.",
    defaultSeverity: "warn",
    color: "hotpink",
  },
  {
    id: "bundle",
    domain: "com.kimi.toolchain.bundle",
    description: "bun build --compile, bundle analysis, and compile-target errors.",
    defaultSeverity: "error",
    color: "slategray",
  },
  {
    id: "http",
    domain: "com.kimi.toolchain.http",
    description: "Bun.serve fetch handler and error-callback failures.",
    defaultSeverity: "error",
    color: "orangered",
  },
] as const satisfies readonly ErrorDomainDefinition[];

export type ErrorDomainId = (typeof ERROR_DOMAIN_DEFINITIONS)[number]["id"];

export const ERROR_DOMAIN_IDS = ERROR_DOMAIN_DEFINITIONS.map(
  (d) => d.id
) as readonly ErrorDomainId[];

export const ERROR_DOMAIN_BY_ID = Object.fromEntries(
  ERROR_DOMAIN_DEFINITIONS.map((d) => [d.id, d])
) as Record<ErrorDomainId, ErrorDomainDefinition>;

export const ERROR_SEVERITY_COLORS: Record<ErrorSeverity, string> = {
  debug: "gray",
  info: "cyan",
  warn: "yellow",
  error: "red",
  fatal: "deeppink",
};

/** Optional taxonomyId → domain hints for structured logging. */
export const TAXONOMY_DOMAIN_HINTS: Partial<Record<string, ErrorDomainId>> = {
  format_check_failure: "cli",
  lint_failure: "cli",
  typecheck_failure: "cli",
  effect_gates_failure: "gates",
  perf_gate_failure: "perf",
  constants_drift: "governance",
  lockfile_issue: "governance",
  guardian_failure: "governance",
  doctor_check_failure: "doctor",
  secrets_unavailable: "secrets",
  secrets_storage_tier_mismatch: "secrets",
};

export const ERROR_REGISTRY_DOC = "docs/identity/error-registry.md";
