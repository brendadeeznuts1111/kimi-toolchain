/**
 * Hook graph cycle verification for Kimi Code lifecycle hooks.
 */

export interface HookCycleVerifyResult {
  ok: boolean;
  cycleLength: number;
  maxCycles: number;
}

export function verifyHookCycleLength(cycleLength: number): HookCycleVerifyResult {
  return {
    ok: cycleLength <= HOOK_VERIFIER_MAX_CYCLES,
    cycleLength,
    maxCycles: HOOK_VERIFIER_MAX_CYCLES,
  };
}
