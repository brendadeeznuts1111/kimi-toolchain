import { benchSync } from "../lib/timing.ts";
import { safeParse } from "../../src/lib/utils.ts";

export function runJsonParseBenchmarks() {
  const payload = JSON.stringify({ a: 1, b: "test", c: [1, 2, 3] });
  return [
    {
      label: "safeParse (small object)",
      sample: benchSync(() => {
        safeParse(payload, {});
      }, 50_000),
    },
  ];
}
