/**
 * Feature flags SSOT — bundle compile-time flags and runtime env toggles.
 *
 * Registry: docs/identity/feature-flags-registry.md
 * Lint: scripts/lint-feature-flags.ts
 */

export type FeatureFlagKind = "bundle" | "env-escape" | "env-opt-in";

export interface FeatureFlagDefinition {
  /** Stable kebab-case id — registry row key and CLI help anchor. */
  id: string;
  kind: FeatureFlagKind;
  /** `bun:bundle` feature name (bundle) or env var (env-*). */
  key: string;
  description: string;
  /** Documented default when unset. */
  defaultEnabled: boolean;
  /** Reverse-domain namespace for structured logging alignment. */
  domain: string;
}

export const FEATURE_FLAG_DEFINITIONS = [
  {
    id: "debug-build",
    kind: "bundle",
    key: "DEBUG",
    description: "Verbose reference inspect/generate logging — eliminated from release bundles.",
    defaultEnabled: false,
    domain: "com.kimi.toolchain.bundle",
  },
  {
    id: "online-build",
    kind: "bundle",
    key: "ONLINE",
    description: "Network-backed reference lint — eliminated from offline bundles.",
    defaultEnabled: false,
    domain: "com.kimi.toolchain.bundle",
  },
  {
    id: "mock-api-build",
    kind: "bundle",
    key: "MOCK_API",
    description: "Mock external APIs in test/agent bundles.",
    defaultEnabled: false,
    domain: "com.kimi.toolchain.bundle",
  },
  {
    id: "premium-build",
    kind: "bundle",
    key: "PREMIUM",
    description: "Premium-only reference lint paths.",
    defaultEnabled: false,
    domain: "com.kimi.toolchain.bundle",
  },
  {
    id: "skip-flaky-tests",
    kind: "env-escape",
    key: "KIMI_SKIP_FLAKY_TESTS",
    description:
      "Tolerate sandbox/EPERM failures in test:fast and r-score during pre-commit/pre-push.",
    defaultEnabled: false,
    domain: "com.kimi.toolchain.gates",
  },
  {
    id: "skip-constant-drift-gate",
    kind: "env-escape",
    key: "KIMI_SKIP_CONSTANT_DRIFT_GATE",
    description: "Bypass constant-drift gate on pre-push.",
    defaultEnabled: false,
    domain: "com.kimi.toolchain.gates",
  },
  {
    id: "skip-effect-gates",
    kind: "env-escape",
    key: "KIMI_SKIP_EFFECT_GATES",
    description: "Bypass Effect-discipline gate on pre-push — document in commit message.",
    defaultEnabled: false,
    domain: "com.kimi.toolchain.gates",
  },
  {
    id: "skip-perf-gates",
    kind: "env-escape",
    key: "KIMI_SKIP_PERF_GATES",
    description: "Bypass perf-gate checks on pre-push.",
    defaultEnabled: false,
    domain: "com.kimi.toolchain.gates",
  },
  {
    id: "skip-portal-gate",
    kind: "env-escape",
    key: "KIMI_SKIP_PORTAL_GATE",
    description: "Bypass artifact portal convergence gate on pre-push.",
    defaultEnabled: false,
    domain: "com.kimi.toolchain.gates",
  },
  {
    id: "skip-governance-preflight",
    kind: "env-escape",
    key: "KIMI_SKIP_GOVERNANCE_PREFLIGHT",
    description:
      "Skip governance preflight auto-fix (lock/README/guardian) before R-Score — emergencies only.",
    defaultEnabled: false,
    domain: "com.kimi.toolchain.governance",
  },
  {
    id: "skip-network-probe",
    kind: "env-escape",
    key: "KIMI_SKIP_NETWORK_PROBE",
    description: "Skip live MCP/network probe assertions in unit tests (CI/offline).",
    defaultEnabled: false,
    domain: "com.kimi.toolchain.testing",
  },
  {
    id: "skip-release-blog-audit",
    kind: "env-escape",
    key: "KIMI_SKIP_RELEASE_BLOG_AUDIT",
    description:
      "Skip live historical blog audit in validate:release-ssot (offline / registry-only checks).",
    defaultEnabled: false,
    domain: "com.kimi.toolchain.governance",
  },
  {
    id: "perf-install",
    kind: "env-opt-in",
    key: "KIMI_PERF_INSTALL",
    description: "Enable install benchmark on CI (opt-in; off by default).",
    defaultEnabled: false,
    domain: "com.kimi.toolchain.perf",
  },
] as const satisfies readonly FeatureFlagDefinition[];

export type FeatureFlagId = (typeof FEATURE_FLAG_DEFINITIONS)[number]["id"];

export const BUNDLE_FEATURE_KEYS = ["DEBUG", "ONLINE", "MOCK_API", "PREMIUM"] as const;
export type BundleFeatureKey = (typeof BUNDLE_FEATURE_KEYS)[number];

export const ENV_ESCAPE_FLAG_KEYS = [
  "KIMI_SKIP_FLAKY_TESTS",
  "KIMI_SKIP_CONSTANT_DRIFT_GATE",
  "KIMI_SKIP_EFFECT_GATES",
  "KIMI_SKIP_PERF_GATES",
  "KIMI_SKIP_PORTAL_GATE",
  "KIMI_SKIP_GOVERNANCE_PREFLIGHT",
  "KIMI_SKIP_NETWORK_PROBE",
  "KIMI_SKIP_RELEASE_BLOG_AUDIT",
] as const;
export type EnvEscapeFlagKey = (typeof ENV_ESCAPE_FLAG_KEYS)[number];

export const ENV_OPT_IN_FLAG_KEYS = ["KIMI_PERF_INSTALL"] as const;
export type EnvOptInFlagKey = (typeof ENV_OPT_IN_FLAG_KEYS)[number];

export type EnvFlagKey = EnvEscapeFlagKey | EnvOptInFlagKey;

export const FEATURE_FLAG_REGISTRY_DOC = "docs/identity/feature-flags-registry.md";
