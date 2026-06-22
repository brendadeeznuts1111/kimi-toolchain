import { describe, expect, test } from "bun:test";
import {
  apiShadowRealm,
  SHADOW_REALM_MODULE_FILES,
  SHADOW_REALM_TMP,
} from "../examples/dashboard/src/handlers/shadowrealm.ts";

describe("shadowrealm", () => {
  test("apiShadowRealm uses repo-local fixtures not /tmp", async () => {
    expect(SHADOW_REALM_TMP).toContain(".tmp/shadow-realm");
    expect(SHADOW_REALM_MODULE_FILES.realm).not.toContain("/tmp/_realm");

    const res = await apiShadowRealm();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      imports: Record<string, unknown>;
      bridging: { result: number };
      fixtures: { realm: string; bridge: string };
    };
    expect(body.ok).toBe(true);
    expect(body.imports["add(2,3)"]).toBe(5);
    expect(body.bridging.result).toBe(16);
    expect(body.fixtures.realm).toBe(SHADOW_REALM_MODULE_FILES.realm);
    expect(await Bun.file(body.fixtures.realm).exists()).toBe(true);
  });

  test("apiShadowRealm dedupes concurrent requests", async () => {
    const [a, b] = await Promise.all([apiShadowRealm(), apiShadowRealm()]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
  });
});
