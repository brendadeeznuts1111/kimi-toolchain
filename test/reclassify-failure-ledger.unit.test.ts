import { describe, expect, test } from "bun:test";
import { loadTaxonomy } from "../src/lib/error-taxonomy.ts";
import { reclassifyFailureRecords } from "../scripts/reclassify-failure-ledger.ts";

describe("reclassify-failure-ledger", () => {
  test("reclassifyFailureRecords moves unknown opaque rows to opaque_hook_output", async () => {
    const taxonomy = await loadTaxonomy();
    const { updated, report } = reclassifyFailureRecords(
      [
        {
          schemaVersion: 1,
          timestamp: "2026-01-01T00:00:00.000Z",
          toolName: "Bash",
          output: "[object Object]",
          taxonomyId: "unknown",
          categoryId: "unknown",
          errorId: "error-opaque1",
        },
        {
          schemaVersion: 1,
          timestamp: "2026-01-01T00:00:01.000Z",
          toolName: "Bash",
          output: "Drifted desktop runtime files:\n  - canonical-references.json",
          taxonomyId: "unknown",
          categoryId: "unknown",
          errorId: "error-sync1",
        },
        {
          schemaVersion: 1,
          timestamp: "2026-01-01T00:00:02.000Z",
          toolName: "Bash",
          output: "already classified",
          taxonomyId: "lint_failure",
          categoryId: "lint_failure",
          errorId: "error-keep1",
        },
      ],
      taxonomy
    );

    expect(report.reclassified).toBe(2);
    expect(report.byTarget.opaque_hook_output).toBe(1);
    expect(report.byTarget.runtime_sync_drift).toBe(1);
    expect(updated[0].taxonomyId).toBe("opaque_hook_output");
    expect(updated[1].taxonomyId).toBe("runtime_sync_drift");
    expect(updated[2].taxonomyId).toBe("lint_failure");
  });
});