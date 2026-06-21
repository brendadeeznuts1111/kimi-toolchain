import { describe, expect, test } from "bun:test";
import { join } from "path";
import { REPO_ROOT } from "./helpers.ts";

const HANDLER = join(REPO_ROOT, "examples/dashboard/src/handlers/bun-runtime.ts");

describe("bun-runtime-dashboard", () => {
  test("apiBunRuntime returns aligned health for toolchain root", async () => {
    const { apiBunRuntime } = await import("../examples/dashboard/src/handlers/bun-runtime.ts");
    const response = await apiBunRuntime();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      applicable: boolean;
      aligned: boolean;
      capabilityCount: number;
      runtimeApiDocs: { globalsUrl: string } | null;
    };
    expect(body.applicable).toBe(true);
    expect(body.aligned).toBe(true);
    expect(body.ok).toBe(true);
    expect(body.capabilityCount).toBe(17);
    expect(body.runtimeApiDocs?.globalsUrl).toBe("https://bun.com/docs/runtime/globals");
  });

  test("handler source uses auditRuntimeCapabilitiesHealth", async () => {
    const source = await Bun.file(HANDLER).text();
    expect(source).toContain("auditRuntimeCapabilitiesHealth");
  });
});
