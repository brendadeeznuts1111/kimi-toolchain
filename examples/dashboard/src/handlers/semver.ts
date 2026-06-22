// ── Semver ────────────────────────────────────────────────────────
// All version comparisons use Bun.semver directly.
// @see https://bun.com/docs/runtime/semver
import { jsonResponse } from "./shared.ts";

/** Map Bun.semver.order result to human-readable label. */
function orderLabel(a: string, b: string): "equal" | "a > b" | "a < b" {
  const o = Bun.semver.order(a, b);
  if (o === 0) return "equal";
  return o === 1 ? "a > b" : "a < b";
}

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
    meaning: orderLabel(a, b),
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
