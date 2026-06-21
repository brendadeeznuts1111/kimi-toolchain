import { describe, expect, test } from "bun:test";
import { join } from "path";
import { REPO_ROOT } from "./helpers.ts";

const HANDLER = join(REPO_ROOT, "examples/dashboard/src/handlers/bun-pm.ts");

describe("bun-pm-dashboard", () => {
  test("apiBunPm returns aligned health for toolchain root", async () => {
    const { apiBunPm } = await import("../examples/dashboard/src/handlers/bun-pm.ts");
    const response = await apiBunPm();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      applicable: boolean;
      aligned: boolean;
      bunPmCli: {
        status: string;
        docsUrl: string;
        sections: Record<string, unknown>;
        commands: { pmHash: string };
      } | null;
      pmHealth: { aligned: boolean; checks: Array<{ name: string; status: string }> } | null;
    };
    expect(body.applicable).toBe(true);
    expect(body.aligned).toBe(true);
    expect(body.ok).toBe(true);
    expect(body.bunPmCli?.status).toBe("available");
    expect(body.bunPmCli?.docsUrl).toBe("https://bun.com/docs/pm/cli/pm");
    expect(Object.keys(body.bunPmCli?.sections ?? {})).toHaveLength(12);
    expect(body.bunPmCli?.commands.pmHash).toBe("bun pm hash");
    expect(body.pmHealth?.checks.some((c) => c.name === "bun-pm:hash-bin-pkg")).toBe(true);
    expect(body.pmHealth?.checks.find((c) => c.name === "bun-pm:hash-bin-pkg")?.status).toBe("ok");
  });

  test("handler source uses buildInstallPolicyReport auditBunPmCliHealth auditRuntimeCapabilitiesHealth", async () => {
    const source = await Bun.file(HANDLER).text();
    expect(source).toContain("buildInstallPolicyReport");
    expect(source).toContain("auditBunPmCliHealth");
    expect(source).toContain("auditRuntimeCapabilitiesHealth");
  });
});
