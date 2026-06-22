import { describe, expect, test } from "bun:test";
import { TEMPLATE_POLICY_CHECK_IDS } from "../../../../../src/lib/template-policy-audit.ts";
import { apiScaffold } from "../scaffold.ts";

describe("dashboard-scaffold-api", () => {
  test("apiScaffold returns bootstrap paths and template policy layers", async () => {
    const res = await apiScaffold();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schemaVersion).toBe(1);
    expect(body.bootstrapPaths).toHaveLength(3);
    expect(body.templatePolicy.layers).toBe(TEMPLATE_POLICY_CHECK_IDS.length);
    expect(body.templatePolicy.checkIds).toContain("oxfmt");
    expect(body.templatePolicy.summary.bunfigFiles).toBeGreaterThan(0);
    expect(body.skills.verbose).toBe("bun run skills:table --verbose");
    expect(body.architecture.policyGate.file).toBe("src/lib/template-policy-audit.ts");
  });
});
