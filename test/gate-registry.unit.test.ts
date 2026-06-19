import { describe, expect, test } from "bun:test";
import { gateRegistry, getGate, listGates, registerGate } from "../src/gates/registry.ts";
import type { Gate } from "../src/gates/types.ts";

describe("gate-registry", () => {
  test("discovers built-in gates", () => {
    const names = listGates();
    expect(names).toContain("bunfig-policy");
    expect(names).toContain("perf-gate");
    expect(names).toContain("tls-compliance");
    expect(names).toContain("url-i18n");
    expect(names).toContain("email-i18n");
    expect(names).toContain("card-probe");
    expect(names).toContain("strategy-performance");
    expect(names).toContain("model-drift");
  });

  test("gateRegistry.list matches listGates", () => {
    expect(gateRegistry.list()).toEqual(listGates());
  });

  test("registerGate adds custom gates", () => {
    const custom: Gate = {
      name: "test-gate-registry-custom",
      description: "test",
      level: 2,
      run: async () => ({ status: "pass" }),
    };
    registerGate(custom);
    expect(getGate("test-gate-registry-custom")).toBe(custom);
  });
});
