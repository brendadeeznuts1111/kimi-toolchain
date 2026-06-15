/**
 * Hook graph cycle verification for Kimi Code lifecycle hooks.
 *
 * @defineDomain hook-verifier
 * @see types/build-constants.d.ts — `KIMI_HOOK_VERIFIER_MAX_CYCLES`
 * @see bunfig.toml `[define]` define-domain:hook-verifier
 */

export interface HookCycleVerifyResult {
  ok: boolean;
  cycleLength: number;
  maxCycles: number;
}

export function verifyHookCycleLength(cycleLength: number): HookCycleVerifyResult {
  return {
    ok: cycleLength <= KIMI_HOOK_VERIFIER_MAX_CYCLES,
    cycleLength,
    maxCycles: KIMI_HOOK_VERIFIER_MAX_CYCLES,
  };
}
