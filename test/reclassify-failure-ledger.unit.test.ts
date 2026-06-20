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

  test("reclassifyFailureRecords maps final unknown buckets", async () => {
    const taxonomy = await loadTaxonomy(`${import.meta.dir}/../error-taxonomy.yml`);
    const { report } = reclassifyFailureRecords(
      [
        {
          schemaVersion: 1,
          timestamp: "2026-01-01T00:00:00.000Z",
          toolName: "Bash",
          output:
            'ERROR  rule 1: from_session "" is not running\nCommand failed with exit code: 2.',
          taxonomyId: "unknown",
          categoryId: "unknown",
          errorId: "error-herdr1",
        },
        {
          schemaVersion: 1,
          timestamp: "2026-01-01T00:00:01.000Z",
          toolName: "Edit",
          output: "old_string is not unique in foo.ts (found 2 occurrences).",
          taxonomyId: "unknown",
          categoryId: "unknown",
          errorId: "error-edit1",
        },
        {
          schemaVersion: 1,
          timestamp: "2026-01-01T00:00:02.000Z",
          toolName: "Bash",
          output: "/bin/bash: Killed: 9\nCommand failed with exit code: 137.",
          taxonomyId: "unknown",
          categoryId: "unknown",
          errorId: "error-kill1",
        },
        {
          schemaVersion: 1,
          timestamp: "2026-01-01T00:00:03.000Z",
          toolName: "Bash",
          output: "── Effect Audit ──\n  ✓ 3 violation(s), 1 error(s)",
          taxonomyId: "unknown",
          categoryId: "unknown",
          errorId: "error-effect1",
        },
        {
          schemaVersion: 1,
          timestamp: "2026-01-01T00:00:04.000Z",
          toolName: "Bash",
          output: "Broken relative imports found:\n  src/lib/foo.ts: ./bar.ts",
          taxonomyId: "unknown",
          categoryId: "unknown",
          errorId: "error-import1",
        },
        {
          schemaVersion: 1,
          timestamp: "2026-01-01T00:00:05.000Z",
          toolName: "Bash",
          output: "long output cut off at cap ✓ lib/predictive",
          taxonomyId: "unknown",
          categoryId: "unknown",
          errorId: "error-trunc1",
        },
      ],
      taxonomy
    );

    expect(report.reclassified).toBe(6);
    expect(report.byTarget.herdr_session_dead).toBe(1);
    expect(report.byTarget.edit_ambiguous).toBe(1);
    expect(report.byTarget.signal_kill).toBe(1);
    expect(report.byTarget.effect_audit_fail).toBe(1);
    expect(report.byTarget.lint_relative_import).toBe(1);
    expect(report.byTarget.bash_truncated).toBe(1);
  });
});
