import { describe, expect, test } from "bun:test";
import {
  EMAIL_I18N_FIXTURES,
  LOCAL_PART_MAX_OCTETS,
  DOMAIN_MAX_OCTETS,
  auditEmailI18n,
  probeEmailI18n,
  validateEmailLocalPart,
} from "../src/lib/email-i18n.ts";
import { runEmailI18nGate, emailI18nGateDefinition } from "../src/gates/email-i18n.ts";

describe("email-i18n", () => {
  test("probeEmailI18n classifies invalid @ patterns", () => {
    expect(
      probeEmailI18n({ email: "", expect: "invalid", invalidReason: "Missing @" })
    ).toMatchObject({
      status: "invalid",
      ok: true,
      reason: "Missing @",
    });
    expect(
      probeEmailI18n({
        email: "user@invalid@domain.com",
        expect: "invalid",
        invalidReason: "Multiple @",
      })
    ).toMatchObject({ status: "invalid", ok: true });
    expect(probeEmailI18n({ email: "@nodomain.com", expect: "invalid" })).toMatchObject({
      status: "invalid",
      ok: true,
      reason: "Empty local part",
    });
    expect(probeEmailI18n({ email: "nouser@", expect: "invalid" })).toMatchObject({
      status: "invalid",
      ok: true,
      reason: "Empty domain part",
    });
  });

  test("validateEmailLocalPart enforces NFC, dots, and control chars", () => {
    expect(validateEmailLocalPart("münchen")).toBeNull();
    expect(validateEmailLocalPart("user.name+tag")).toBeNull();
    expect(validateEmailLocalPart(".leading")).toMatch(/dot-atom/);
    expect(validateEmailLocalPart("trailing.")).toMatch(/dot-atom/);
    expect(validateEmailLocalPart("a..b")).toMatch(/consecutive dots/);
    expect(validateEmailLocalPart("bad\u0007char")).toMatch(/control characters/);
    const nfd = "e\u0301";
    expect(validateEmailLocalPart(nfd)).toMatch(/NFC/);
  });

  test("probeEmailI18n validates UTF-8 octet lengths and punycode domains", () => {
    const probe = probeEmailI18n({ email: "用户@例子.com", expect: "valid" });
    expect(probe.ok).toBe(true);
    expect(probe.status).toBe("pass");
    expect(probe.localOctets).toBeLessThanOrEqual(LOCAL_PART_MAX_OCTETS);
    expect(probe.domainOctets).toBeLessThanOrEqual(DOMAIN_MAX_OCTETS);
    expect(probe.localHasUnicode).toBe(true);
    expect(probe.asciiDomain).toContain("xn--");
    expect(probe.domainIdempotent).toBe(true);
  });

  test("auditEmailI18n passes all fixtures", () => {
    const audit = auditEmailI18n();
    expect(audit.ok).toBe(true);
    expect(audit.summary.total).toBe(EMAIL_I18N_FIXTURES.length);
    expect(audit.summary.failed).toBe(0);
    expect(audit.lengthValid).toBe(true);
    expect(audit.domainIdempotent).toBe(true);
    expect(audit.limitations.length).toBeGreaterThan(0);
    expect(audit.probes.every((row) => row.ok)).toBe(true);
  });

  test("runEmailI18nGate returns pass", async () => {
    const result = await runEmailI18nGate();
    expect(result.status).toBe("pass");
    expect(emailI18nGateDefinition.name).toBe("email-i18n");
    expect(emailI18nGateDefinition.level).toBe(1);
  });
});
