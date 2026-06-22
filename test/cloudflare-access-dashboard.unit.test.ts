import { describe, expect, test } from "bun:test";
import { buildDashboard, domainToProjectName } from "../src/lib/cloudflare-access.ts";
import type { AccessApplication } from "../src/lib/cloudflare-access.ts";

function app(overrides: Partial<AccessApplication> = {}): AccessApplication {
  return {
    id: "app-1",
    name: "Test App",
    type: "self_hosted",
    policies: [],
    ...overrides,
  };
}

describe("cloudflare-access dashboard", () => {
  describe("domainToProjectName", () => {
    test("extracts subdomain from domain", () => {
      expect(domainToProjectName("ledger.factory-wager.com")).toBe("ledger");
    });
    test("handles wildcard paths", () => {
      expect(domainToProjectName("ledger.factory-wager.com/api/*")).toBe("ledger");
    });
    test("handles plain host", () => {
      expect(domainToProjectName("api.example.com")).toBe("api");
    });
    test("returns empty for missing domain", () => {
      expect(domainToProjectName(undefined)).toBe("");
    });
  });

  describe("buildDashboard", () => {
    test("maps apps with no local project and no policy issues as info", async () => {
      const apps = [
        app({
          id: "a1",
          name: "zzzz-nonexistent-9999",
          type: "self_hosted",
          domain: "zzzz-nonexistent-9999.factory-wager.com",
          allowed_idps: ["idp-1"],
          policies: [
            {
              id: "p1",
              name: "Allow",
              decision: "allow",
              include: [{ email: { email: "a@b.com" } }],
              exclude: [],
              require: [],
            },
          ],
        }),
      ];
      const mappings = await buildDashboard(apps, []);
      expect(mappings).toHaveLength(1);
      expect(mappings[0]!.appName).toBe("zzzz-nonexistent-9999");
      expect(mappings[0]!.localPath).toBeUndefined();
      expect(mappings[0]!.status).toBe("info");
      expect(mappings[0]!.notes.some((n) => n.includes("No local project"))).toBe(true);
    });

    test("flags bypass policies as error", async () => {
      const apps = [
        app({
          id: "a2",
          name: "BypassApp",
          type: "self_hosted",
          domain: "bypass.factory-wager.com",
          policies: [
            {
              id: "p2",
              name: "Bypass",
              decision: "bypass",
              include: [{ everyone: {} }],
              exclude: [],
              require: [],
            },
          ],
        }),
      ];
      const mappings = await buildDashboard(apps, []);
      expect(mappings[0]!.status).toBe("error");
      expect(mappings[0]!.bypassCount).toBe(1);
      expect(mappings[0]!.notes.some((n) => n.includes("bypass"))).toBe(true);
    });

    test("flags allow-everyone as warn", async () => {
      const apps = [
        app({
          id: "a3",
          name: "OpenApp",
          type: "self_hosted",
          domain: "open.factory-wager.com",
          policies: [
            {
              id: "p3",
              name: "Open",
              decision: "allow",
              include: [{ everyone: {} }],
              exclude: [],
              require: [],
            },
          ],
        }),
      ];
      const mappings = await buildDashboard(apps, []);
      expect(mappings[0]!.allowEveryoneCount).toBe(1);
      expect(mappings[0]!.notes.some((n) => n.includes("allow everyone"))).toBe(true);
    });

    test("flags no IdP restriction for self_hosted apps", async () => {
      const apps = [
        app({
          id: "a4",
          name: "NoIdpApp",
          type: "self_hosted",
          domain: "noidp.factory-wager.com",
          allowed_idps: [],
          policies: [
            {
              id: "p4",
              name: "Allow",
              decision: "allow",
              include: [{ email: { email: "a@b.com" } }],
              exclude: [],
              require: [],
            },
          ],
        }),
      ];
      const mappings = await buildDashboard(apps, []);
      expect(mappings[0]!.notes.some((n) => n.includes("No IdP"))).toBe(true);
    });

    test("discovers local kimi-toolchain repo", async () => {
      const apps = [
        app({
          id: "a5",
          name: "kimi-toolchain",
          type: "self_hosted",
          domain: "kimi-toolchain.factory-wager.com",
          policies: [],
        }),
      ];
      const mappings = await buildDashboard(apps, []);
      const m = mappings[0]!;
      // Should find the local repo if it exists
      if (m.localPath) {
        expect(m.localPath).toContain("kimi-toolchain");
        expect(typeof m.hasWranglerConfig).toBe("boolean");
      }
    });

    test("summary counts are correct", async () => {
      const apps = [
        app({
          id: "a1",
          name: "OkApp-9999",
          type: "self_hosted",
          domain: "okapp-9999.factory-wager.com",
          allowed_idps: ["idp1"],
          policies: [
            {
              id: "p0",
              name: "Secure",
              decision: "allow",
              include: [{ email: { email: "a@b.com" } }],
              exclude: [],
              require: [],
            },
          ],
        }),
        app({
          id: "a2",
          name: "WarnApp-9999",
          type: "self_hosted",
          domain: "warnapp-9999.factory-wager.com",
          allowed_idps: ["idp1"],
          policies: [
            {
              id: "p1",
              name: "Open",
              decision: "allow",
              include: [{ everyone: {} }],
              exclude: [],
              require: [],
            },
          ],
        }),
        app({
          id: "a3",
          name: "ErrApp-9999",
          type: "self_hosted",
          domain: "errapp-9999.factory-wager.com",
          allowed_idps: ["idp1"],
          policies: [
            {
              id: "p2",
              name: "Bypass",
              decision: "bypass",
              include: [{ everyone: {} }],
              exclude: [],
              require: [],
            },
          ],
        }),
      ];
      const mappings = await buildDashboard(apps, []);
      // No local projects found, so OkApp is "info" not "ok"
      expect(mappings.filter((m) => m.status === "info").length).toBe(1);
      expect(mappings.filter((m) => m.status === "warn").length).toBe(1);
      expect(mappings.filter((m) => m.status === "error").length).toBe(1);
    });
  });
});
