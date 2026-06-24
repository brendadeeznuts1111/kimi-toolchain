import { benchSync } from "../lib/timing.ts";
import { computeRScore } from "../../src/lib/r-score.ts";

export function runRScoreBenchmarks() {
  const input = {
    hasLicense: true,
    hasContributing: true,
    hasCodeowners: true,
    hasReadme: true,
    hasContext: true,
    hasChangelog: true,
    coveragePercentage: 85,
    docsFresh: true,
    staleLockfile: false,
  };
  return [
    {
      label: "computeRScore (full)",
      sample: benchSync(() => {
        computeRScore(input);
      }, 100_000),
    },
  ];
}
