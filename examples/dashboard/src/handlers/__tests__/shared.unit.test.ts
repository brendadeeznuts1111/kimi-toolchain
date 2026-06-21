import { describe, expect, test } from "bun:test";
import {
  isAllowedMethod,
  jsonResponse,
  methodNotAllowedJson,
  resolveRoot,
} from "../shared.ts";

describe("dashboard-shared", () => {
  test("resolveRoot resolves kimi-toolchain repo root", () => {
    const root = resolveRoot();
    expect(root.endsWith("kimi-toolchain")).toBe(true);
  });

  test("methodNotAllowedJson returns structured 405", async () => {
    const res = methodNotAllowedJson("POST", "/api/gates", ["GET"]);
    expect(res.status).toBe(405);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.method).toBe("POST");
    expect(body.path).toBe("/api/gates");
    expect(body.allowed).toEqual(["GET"]);
  });

  test("isAllowedMethod accepts declared methods only", () => {
    expect(isAllowedMethod("GET", ["GET", "HEAD"])).toBe(true);
    expect(isAllowedMethod("HEAD", ["GET", "HEAD"])).toBe(true);
    expect(isAllowedMethod("POST", ["GET"])).toBe(false);
  });

  test("jsonResponse sets application/json", async () => {
    const res = jsonResponse({ ok: true });
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ ok: true });
  });
});