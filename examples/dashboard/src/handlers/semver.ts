// ── Semver ────────────────────────────────────────────────────────
import { compareVersions, semverOrderLabel, semverSatisfies } from "../../../../src/lib/version.ts";
import { jsonResponse } from "./shared.ts";

export async function apiSemver(): Promise<Response> {
  const pairs: [string, string][] = [
    ["1.0.0", "1.0.0"],
    ["2.0.0", "1.9.9"],
    ["1.0.0", "2.0.0"],
    ["1.2.3", "1.2.3-alpha.1"],
  ];
  const orderResults = pairs.map(([a, b]) => ({
    a,
    b,
    result: compareVersions(a, b),
    meaning: semverOrderLabel(a, b),
  }));

  const satisfiesResults = [
    { version: "1.5.0", range: "^1.0.0", satisfies: semverSatisfies("1.5.0", "^1.0.0") },
    { version: "2.0.0", range: "^1.0.0", satisfies: semverSatisfies("2.0.0", "^1.0.0") },
    {
      version: "1.2.3",
      range: ">=1.0.0 <2.0.0",
      satisfies: semverSatisfies("1.2.3", ">=1.0.0 <2.0.0"),
    },
  ];

  return jsonResponse({
    order: orderResults,
    satisfies: satisfiesResults,
    note: "compareVersions(a,b) → -1|0|1 via Bun.semver.order. semverSatisfies(v,range) → boolean.",
  });
}
