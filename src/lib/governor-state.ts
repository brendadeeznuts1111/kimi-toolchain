/**
 * Shared mutable state for resource governor defaults
 */

import {
  loadGovernorDefaults,
  BUILTIN_DEFAULTS,
  type GovernorDefaults,
} from "./governor-config.ts";

export let DEFAULTS: GovernorDefaults = { ...BUILTIN_DEFAULTS };

export async function ensureDefaultsLoaded(): Promise<void> {
  DEFAULTS = await loadGovernorDefaults();
}
