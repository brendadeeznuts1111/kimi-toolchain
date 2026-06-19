import {
  evaluateProbeHandoffCondition,
  isCanonicalReferencesProbeId,
} from "./canonical-references.ts";
import { evaluateFinishWorkProbeCondition, isFinishWorkProbeId } from "./finish-work-herdr.ts";

/** Evaluate any supported `probe:*` handoff condition. */
export async function evaluateHandoffProbeCondition(
  probeId: string,
  projectRoot: string,
  home?: string
): Promise<{ ok: boolean; message: string }> {
  if (isCanonicalReferencesProbeId(probeId)) {
    return evaluateProbeHandoffCondition(probeId, projectRoot, home);
  }
  if (isFinishWorkProbeId(probeId)) {
    return evaluateFinishWorkProbeCondition(probeId, projectRoot);
  }
  return { ok: false, message: `unknown probe condition: ${probeId}` };
}
