import { benchSync } from "../lib/timing.ts";
import { getOrphanProcesses, clearProcessCache } from "../../src/lib/process-utils.ts";

export function runOrphanProcessBenchmarks() {
  return [
    {
      label: "getOrphanProcesses (cold)",
      sample: benchSync(() => {
        clearProcessCache();
        getOrphanProcesses();
      }, 50),
    },
    {
      label: "getOrphanProcesses (cached)",
      sample: benchSync(() => {
        getOrphanProcesses();
      }, 50),
    },
  ];
}
