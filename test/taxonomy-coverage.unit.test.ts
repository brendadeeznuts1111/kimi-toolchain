import { describe, expect, test } from "bun:test";
import { auditTaxonomyCoverage } from "../src/lib/taxonomy-coverage.ts";

import { REPO_ROOT } from "./helpers.ts";
describe("taxonomy-coverage", () => {
  test("reports linked and unlinked taxonomy categories", async () => {
    const report = await auditTaxonomyCoverage(REPO_ROOT);
    expect(report.applicable).toBe(true);
    expect(report.rows.length).toBeGreaterThan(0);

    const lockfile = report.rows.find((row) => row.taxonomyId === "lockfile_issue");
    expect(lockfile?.status).toBe("ok");
    expect(lockfile?.boundCount).toBeGreaterThan(0);

    const network = report.rows.find((row) => row.taxonomyId === "network_timeout");
    expect(network?.status).toBe("warn");
    expect(network?.message).toContain("no boundConstants");
  });
});
