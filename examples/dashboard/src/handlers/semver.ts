// ── Semver ────────────────────────────────────────────────────────
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
    result: Bun.semver.order(a, b),
    meaning:
      Bun.semver.order(a, b) === 0 ? "equal" : Bun.semver.order(a, b) === 1 ? "a > b" : "a < b",
  }));

  const satisfiesResults = [
    { version: "1.5.0", range: "^1.0.0", satisfies: Bun.semver.satisfies("1.5.0", "^1.0.0") },
    { version: "2.0.0", range: "^1.0.0", satisfies: Bun.semver.satisfies("2.0.0", "^1.0.0") },
    {
      version: "1.2.3",
      range: ">=1.0.0 <2.0.0",
      satisfies: Bun.semver.satisfies("1.2.3", ">=1.0.0 <2.0.0"),
    },
  ];

  return jsonResponse({
    order: orderResults,
    satisfies: satisfiesResults,
    note: "Bun.semver.order(a,b) → -1|0|1. Bun.semver.satisfies(v,range) → boolean.",
  });
}
