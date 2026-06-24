import { benchSync } from "../lib/timing.ts";
import { getOrphanCandidates, clearProcessCache } from "../../src/lib/proc-cache.ts";

export function runOrphanProcessBenchmarks() {
  return [
    {
      label: "getOrphanCandidates (cold)",
      sample: benchSync(() => {
        clearProcessCache();
        getOrphanCandidates();
      }, 50),
    },
    {
      label: "getOrphanCandidates (cached)",
      sample: benchSync(() => {
        getOrphanCandidates();
      }, 50),
    },
  ];
}
