import { describe, expect, test } from "bun:test";
import {
  computeDiff,
  loadPolicyConfig,
  type AccessPolicyConfig,
  type LiveState,
} from "../src/lib/cloudflare-access-policy.ts";

describe("cloudflare-access-policy", () => {
  describe("loadPolicyConfig", () => {
    test("parses simple app with policies", async () => {
      const yaml = `
apps:
  - name: Test App
    domain: test.example.com
    type: self_hosted
    session_duration: 8h
    allowed_idps: [okta]
    policies:
      - name: Allow Employees
        decision: allow
        include:
          - email_domain:
              domain: example.com
        require:
          - auth_method:
              auth_method: otp
`;
      const config = await parsePolicyConfig(yaml);
      expect(config).not.toBeNull();
      expect(config!.apps).toHaveLength(1);
      expect(config!.apps[0]!.name).toBe("Test App");
      expect(config!.apps[0]!.domain).toBe("test.example.com");
      expect(config!.apps[0]!.session_duration).toBe("8h");
      expect(config!.apps[0]!.allowed_idps).toEqual(["okta"]);
      expect(config!.apps[0]!.policies).toHaveLength(1);
      expect(config!.apps[0]!.policies[0]!.name).toBe("Allow Employees");
      expect(config!.apps[0]!.policies[0]!.decision).toBe("allow");
      expect(config!.apps[0]!.policies[0]!.include).toHaveLength(1);
    });

    test("returns null when no config file exists", async () => {
      const config = await loadPolicyConfig("/nonexistent/path");
      expect(config).toBeNull();
    });
  });

  describe("computeDiff", () => {
    test("detects app to create", () => {
      const desired: AccessPolicyConfig = {
        apps: [{ name: "New App", domain: "new.example.com", policies: [] }],
      };
      const live: LiveState = { apps: [] };
      const diff = computeDiff(desired, live);
      expect(diff).toHaveLength(1);
      expect(diff[0]!.action).toBe("create");
      expect(diff[0]!.appName).toBe("New App");
    });

    test("detects app to delete", () => {
      const desired: AccessPolicyConfig = { apps: [] };
      const live: LiveState = {
        apps: [{ id: "1", name: "Old App", policies: [] }],
      };
      const diff = computeDiff(desired, live);
      expect(diff).toHaveLength(1);
      expect(diff[0]!.action).toBe("delete");
      expect(diff[0]!.appName).toBe("Old App");
    });

    test("detects noop when states match", () => {
      const desired: AccessPolicyConfig = {
        apps: [
          {
            name: "Same App",
            policies: [
              {
                name: "Allow",
                decision: "allow",
                include: [{ email_domain: { domain: "example.com" } }],
              },
            ],
          },
        ],
      };
      const live: LiveState = {
        apps: [
          {
            id: "1",
            name: "Same App",
            policies: [
              {
                id: "p1",
                name: "Allow",
                decision: "allow",
                include: [{ email_domain: { domain: "example.com" } }],
                exclude: [],
                require: [],
              },
            ],
          },
        ],
      };
      const diff = computeDiff(desired, live);
      expect(diff).toHaveLength(1);
      expect(diff[0]!.action).toBe("noop");
    });

    test("detects policy changes", () => {
      const desired: AccessPolicyConfig = {
        apps: [
          {
            name: "App",
            policies: [
              {
                name: "Allow",
                decision: "allow",
                include: [{ email_domain: { domain: "example.com" } }],
              },
            ],
          },
        ],
      };
      const live: LiveState = {
        apps: [
          {
            id: "1",
            name: "App",
            policies: [
              {
                id: "p1",
                name: "Allow",
                decision: "bypass",
                include: [{ email_domain: { domain: "example.com" } }],
                exclude: [],
                require: [],
              },
            ],
          },
        ],
      };
      const diff = computeDiff(desired, live);
      expect(diff[0]!.action).toBe("update");
      expect(diff[0]!.policyChanges?.[0]!.action).toBe("update");
      expect(diff[0]!.policyChanges?.[0]!.changes).toContain("decision: bypass → allow");
    });

    test("detects app setting changes", () => {
      const desired: AccessPolicyConfig = {
        apps: [{ name: "App", domain: "new.example.com", policies: [] }],
      };
      const live: LiveState = {
        apps: [{ id: "1", name: "App", domain: "old.example.com", policies: [] }],
      };
      const diff = computeDiff(desired, live);
      expect(diff[0]!.action).toBe("update");
      expect(diff[0]!.appChanges).toContain("domain: old.example.com → new.example.com");
    });
  });
});

function parsePolicyConfig(yaml: string) {
  // Reuse the internal parser by writing to the correct filename in cwd
  const tmpPath = `${process.cwd()}/.cloudflare-access.yml`;
  Bun.write(tmpPath, yaml);
  return loadPolicyConfig(process.cwd()).then((c) => {
    try {
      Bun.file(tmpPath).delete?.();
    } catch {}
    return c;
  });
}
