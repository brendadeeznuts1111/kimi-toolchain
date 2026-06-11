import { describe, expect, test } from "bun:test";
import {
  AccessApplication,
  AccessPolicy,
  auditApps,
  checkTokenExpiry,
  parseSessionHours,
  ServiceToken,
} from "../src/bin/kimi-cloudflare-access.ts";

function token(overrides: Partial<ServiceToken> = {}): ServiceToken {
  return {
    id: "tok-1",
    name: "Test Token",
    client_id: "test.access",
    ...overrides,
  };
}

function policy(overrides: Partial<AccessPolicy> = {}): AccessPolicy {
  return {
    id: "pol-1",
    name: "Default Policy",
    decision: "allow",
    include: [],
    exclude: [],
    require: [],
    ...overrides,
  };
}

function app(overrides: Partial<AccessApplication> = {}): AccessApplication {
  return {
    id: "app-1",
    name: "Test App",
    type: "self_hosted",
    policies: [],
    ...overrides,
  };
}

describe("cloudflare-access logic", () => {
  describe("checkTokenExpiry", () => {
    test("returns empty for healthy tokens", () => {
      const future = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
      const violations = checkTokenExpiry([token({ expires_at: future })], 30);
      expect(violations).toHaveLength(0);
    });

    test("flags expired tokens", () => {
      const past = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
      const violations = checkTokenExpiry([token({ expires_at: past })], 30);
      expect(violations).toHaveLength(1);
      expect(violations[0].reason).toBe("expired");
      expect(violations[0].daysRemaining).toBeLessThanOrEqual(-5);
    });

    test("flags tokens expiring within warn window", () => {
      const soon = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
      const violations = checkTokenExpiry([token({ expires_at: soon })], 30);
      expect(violations).toHaveLength(1);
      expect(violations[0].reason).toBe("expiring-soon");
      expect(violations[0].daysRemaining).toBe(10);
    });

    test("flags tokens with no expiry", () => {
      const violations = checkTokenExpiry([token({ expires_at: null })], 30);
      expect(violations).toHaveLength(1);
      expect(violations[0].reason).toBe("no-expiry");
    });

    test("flags tokens with unparseable expiry", () => {
      const violations = checkTokenExpiry([token({ expires_at: "not-a-date" })], 30);
      expect(violations).toHaveLength(1);
      expect(violations[0].reason).toBe("no-expiry");
    });

    test("skips tokens without id", () => {
      const future = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
      const violations = checkTokenExpiry([token({ id: "", expires_at: future })], 30);
      expect(violations).toHaveLength(0);
    });
  });

  describe("parseSessionHours", () => {
    test("defaults to 24", () => {
      expect(parseSessionHours()).toBe(24);
      expect(parseSessionHours("")).toBe(24);
    });

    test("parses hours", () => {
      expect(parseSessionHours("8h")).toBe(8);
      expect(parseSessionHours("168h")).toBe(168);
    });

    test("parses days", () => {
      expect(parseSessionHours("1d")).toBe(24);
      expect(parseSessionHours("7d")).toBe(168);
    });

    test("falls back for unknown formats", () => {
      expect(parseSessionHours("1w")).toBe(24);
      expect(parseSessionHours("30m")).toBe(24);
    });
  });

  describe("auditApps", () => {
    test("flags app with no policies as allow-everyone", () => {
      const findings = auditApps([app({ policies: [] })], []);
      expect(findings).toHaveLength(1);
      expect(findings[0].reason).toBe("allow-everyone");
      expect(findings[0].detail).toContain("No policies");
    });

    test("flags bypass policy", () => {
      const p = policy({ decision: "bypass" });
      const findings = auditApps([app({ policies: [p] })], []);
      expect(findings.some((f) => f.reason === "bypass")).toBe(true);
    });

    test("flags allow-everyone include rule", () => {
      const p = policy({ include: [{ everyone: {} }] });
      const findings = auditApps([app({ policies: [p] })], []);
      expect(findings.some((f) => f.reason === "allow-everyone")).toBe(true);
    });

    test("flags missing MFA", () => {
      const p = policy({ include: [{ email_domain: { domain: "example.com" } }] });
      const findings = auditApps([app({ policies: [p] })], []);
      expect(findings.some((f) => f.reason === "missing-mfa")).toBe(true);
    });

    test("does not flag MFA when auth_method required", () => {
      const p = policy({
        include: [{ email_domain: { domain: "example.com" } }],
        require: [{ auth_method: { auth_method: "otp" } }],
      });
      const findings = auditApps([app({ policies: [p] })], []);
      expect(findings.some((f) => f.reason === "missing-mfa")).toBe(false);
    });

    test("flags shared service token", () => {
      const t = token({ id: "shared-1" });
      const p = policy({
        include: [{ service_token: { token_id: "shared-1" } }],
      });
      const findings = auditApps([app({ policies: [p] })], [t]);
      expect(findings.some((f) => f.reason === "shared-service-token")).toBe(true);
    });

    test("flags redundant service token when everyone is also allowed", () => {
      const t = token({ id: "shared-1" });
      const p = policy({
        include: [{ everyone: {} }, { service_token: { token_id: "shared-1" } }],
      });
      const findings = auditApps([app({ policies: [p] })], [t]);
      expect(findings.some((f) => f.reason === "redundant-service-token")).toBe(true);
      expect(findings.some((f) => f.reason === "shared-service-token")).toBe(false);
    });

    test("flags long session duration", () => {
      const findings = auditApps([app({ policies: [policy()], session_duration: "336h" })], []);
      expect(findings.some((f) => f.reason === "long-session")).toBe(true);
    });

    test("flags no IdP restriction for self_hosted app", () => {
      const findings = auditApps([app({ policies: [policy()] })], []);
      expect(findings.some((f) => f.reason === "no-idp-restriction")).toBe(true);
    });

    test("does not flag IdP restriction when allowed_idps set", () => {
      const findings = auditApps([app({ policies: [policy()], allowed_idps: ["idp-1"] })], []);
      expect(findings.some((f) => f.reason === "no-idp-restriction")).toBe(false);
    });

    test("ignores IdP restriction for non-identity app types", () => {
      const findings = auditApps([app({ type: "infrastructure", policies: [policy()] })], []);
      expect(findings.some((f) => f.reason === "no-idp-restriction")).toBe(false);
    });

    test("ignores IdP restriction for app_launcher", () => {
      const findings = auditApps([app({ type: "app_launcher", policies: [policy()] })], []);
      expect(findings.some((f) => f.reason === "no-idp-restriction")).toBe(false);
    });

    test("returns empty for clean app", () => {
      const p = policy({
        include: [{ email_domain: { domain: "example.com" } }],
        require: [{ auth_method: { auth_method: "otp" } }],
      });
      const findings = auditApps(
        [
          app({
            policies: [p],
            allowed_idps: ["idp-1"],
            session_duration: "8h",
          }),
        ],
        []
      );
      expect(findings).toHaveLength(0);
    });
  });
});
