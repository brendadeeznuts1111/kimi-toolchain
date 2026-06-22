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
        sections: Record<string, unknown> | unknown[];
        commands: { hash?: string; pmHash?: string };
      } | null;
      pmHealth: { aligned: boolean; checks: Array<{ name: string; status: string }> } | null;
    };
    expect(body.applicable).toBe(true);
    expect(body.aligned).toBe(true);
    expect(body.ok).toBe(true);
    const pmStatus = body.bunPmCli?.status;
    expect(pmStatus === "available" || pmStatus === "active").toBe(true);
    expect(body.bunPmCli?.docsUrl).toBe("https://bun.com/docs/pm/cli/pm");
    const sections = body.bunPmCli?.sections;
    const sectionCount = Array.isArray(sections)
      ? sections.length
      : Object.keys(sections ?? {}).length;
    expect(sectionCount).toBe(12);
    const hashCmd = body.bunPmCli?.commands.hash ?? body.bunPmCli?.commands.pmHash;
    expect(hashCmd).toBe("bun pm hash");
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
