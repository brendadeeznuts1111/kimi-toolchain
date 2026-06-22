/**
 * Feature flag runtime helpers — reads env toggles; bundle flags stay in features.ts.
 *
 * @see feature-flags-constants.ts — SSOT definitions
 * @see features.ts — `bun:bundle` compile-time flags
 */

import {
  BUNDLE_FEATURE_KEYS,
  ENV_ESCAPE_FLAG_KEYS,
  ENV_OPT_IN_FLAG_KEYS,
  FEATURE_FLAG_DEFINITIONS,
  FEATURE_FLAG_REGISTRY_DOC,
  type BundleFeatureKey,
  type EnvEscapeFlagKey,
  type EnvFlagKey,
  type EnvOptInFlagKey,
  type FeatureFlagDefinition,
  type FeatureFlagId,
  type FeatureFlagKind,
} from "./feature-flags-constants.ts";

export {
  BUNDLE_FEATURE_KEYS,
  ENV_ESCAPE_FLAG_KEYS,
  ENV_OPT_IN_FLAG_KEYS,
  FEATURE_FLAG_DEFINITIONS,
  FEATURE_FLAG_REGISTRY_DOC,
  type BundleFeatureKey,
  type EnvEscapeFlagKey,
  type EnvFlagKey,
  type EnvOptInFlagKey,
  type FeatureFlagDefinition,
  type FeatureFlagId,
  type FeatureFlagKind,
};

/** True when an env escape hatch is set to `1`. */
export function isEnvEscapeEnabled(key: EnvEscapeFlagKey): boolean {
  return Bun.env[key] === "1";
}

/** True when an env opt-in flag is set to `1`. */
export function isEnvOptInEnabled(key: EnvOptInFlagKey): boolean {
  return Bun.env[key] === "1";
}

/** True when any registered env flag (escape or opt-in) is set to `1`. */
export function isEnvFlagEnabled(key: EnvFlagKey): boolean {
  return Bun.env[key] === "1";
}

export function getFeatureFlagById(id: FeatureFlagId): FeatureFlagDefinition | undefined {
  return FEATURE_FLAG_DEFINITIONS.find((def) => def.id === id);
}

export function getFeatureFlagByKey(key: string): FeatureFlagDefinition | undefined {
  return FEATURE_FLAG_DEFINITIONS.find((def) => def.key === key);
}

export function listFeatureFlags(kind?: FeatureFlagKind): readonly FeatureFlagDefinition[] {
  if (!kind) return FEATURE_FLAG_DEFINITIONS;
  return FEATURE_FLAG_DEFINITIONS.filter((def) => def.kind === kind);
}
