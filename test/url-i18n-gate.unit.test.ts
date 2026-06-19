import { describe, expect, test } from "bun:test";
import {
  auditUrlI18n,
  probeUrlI18nDomain,
  probeUrlI18nLabel,
  resolveUrlHostnameAscii,
} from "../src/lib/url-i18n.ts";
import { runUrlI18nGate, urlI18nGateDefinition } from "../src/gates/url-i18n.ts";

describe("url-i18n", () => {
  test("probeUrlI18nDomain normalizes Unicode and preserves ASCII", () => {
    expect(probeUrlI18nDomain("example.com")).toMatchObject({
      ascii: "example.com",
      display: "example.com",
      idempotent: true,
      roundtrip: true,
      punycodeEncoded: true,
    });
    expect(probeUrlI18nDomain("mañana.com")).toMatchObject({
      ascii: "xn--maana-pta.com",
      display: "mañana.com",
      idempotent: true,
      roundtrip: true,
      punycodeEncoded: true,
    });
    expect(probeUrlI18nDomain("xn--maana-pta.com")).toMatchObject({
      ascii: "xn--maana-pta.com",
      display: "mañana.com",
      idempotent: true,
      roundtrip: true,
      punycodeEncoded: true,
    });
    expect(probeUrlI18nDomain("bücher.de")).toMatchObject({
      ascii: "xn--bcher-kva.de",
      display: "bücher.de",
      punycodeEncoded: true,
    });
    expect(probeUrlI18nDomain("")).toMatchObject({
      ascii: "",
      display: "",
      idempotent: true,
      roundtrip: true,
      punycodeEncoded: true,
    });
    expect(probeUrlI18nDomain("xn--")).toMatchObject({
      ascii: "xn--",
      roundtrip: true,
      punycodeEncoded: true,
    });
  });

  test("probeUrlI18nLabel uses punycode.encode/decode on single labels", () => {
    expect(probeUrlI18nLabel("mañana")).toMatchObject({
      encoded: "maana-pta",
      decoded: "mañana",
      asciiLabel: "xn--maana-pta",
      roundtrip: true,
    });
  });

  test("non-ASCII domains require punycodePrefixCorrect (xn-- label)", () => {
    for (const domain of ["mañana.com", "☃-⌘.com", "bücher.de", "münchen.de"] as const) {
      const probe = probeUrlI18nDomain(domain);
      expect(probe.punycodePrefixCorrect).toBe(true);
      expect(probe.punycodeEncoded).toBe(probe.punycodePrefixCorrect);
      expect(probe.ascii.split(".").some((label) => label.startsWith("xn--"))).toBe(true);
    }
    expect(probeUrlI18nDomain("example.com").punycodePrefixCorrect).toBe(true);
  });

  test("auditUrlI18n passes local punycode fixtures", () => {
    const audit = auditUrlI18n();
    expect(audit.ok).toBe(true);
    expect(audit.idempotent).toBe(true);
    expect(audit.roundtrip).toBe(true);
    expect(audit.punycodeEncoded).toBe(true);
    expect(audit.punycodePrefixCorrect).toBe(true);
    expect(audit.probes.length).toBe(9);
    expect(audit.labelProbes.length).toBeGreaterThan(0);
    expect(audit.urlProbes[0]?.hostnameAscii).toBe("xn--maana-pta.com");
    expect(audit.docs.encode).toContain("punycode/encode");
    expect(audit.docs.domainToUnicode).toContain("domainToUnicode");
  });

  test("resolveUrlHostnameAscii decomposes absolute URLs", () => {
    expect(resolveUrlHostnameAscii("https://mañana.com/v1")).toBe("xn--maana-pta.com");
  });

  test("runUrlI18nGate returns pass", async () => {
    const result = await runUrlI18nGate();
    expect(result.status).toBe("pass");
    expect(urlI18nGateDefinition.name).toBe("url-i18n");
    expect(urlI18nGateDefinition.level).toBe(1);
  });
});
