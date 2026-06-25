import { describe, expect, test } from "bun:test";
import { parseDiffStat, passesDeletionMetric } from "../src/lib/deletion-metric.ts";

describe("deletion-metric", () => {
  test("enforces 3× ratio", () => {
    const m = parseDiffStat(" 1 file changed, 10 insertions(+), 30 deletions(-)");
    expect(passesDeletionMetric(m, 3)).toBe(true);
  });

  test("excise requires net-negative diff", () => {
    const ok = parseDiffStat(" 1 file changed, 1 insertion(+), 4 deletions(-)");
    const bad = parseDiffStat(" 1 file changed, 4 insertions(+), 1 deletion(-)");
    expect(ok.deleted > 0 && ok.deleted >= ok.added).toBe(true);
    expect(bad.deleted > 0 && bad.deleted >= bad.added).toBe(false);
  });
});
