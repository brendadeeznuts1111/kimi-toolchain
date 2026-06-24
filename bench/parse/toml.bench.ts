import { benchSync } from "../lib/timing.ts";
import { safeToml } from "../../src/lib/utils.ts";

export function runTomlParseBenchmarks() {
  const payload = '[section]\nkey = "value"\nnum = 42\n';
  return [
    {
      label: "safeToml (small table)",
      sample: benchSync(() => {
        safeToml(payload, {});
      }, 20_000),
    },
  ];
}
