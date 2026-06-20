import { describe, expect, test } from "bun:test";
import { EMAIL_I18N_GATE_THRESHOLD_MS, validateEmail } from "../src/gates/email-i18n.ts";
import { LOCAL_PART_MAX_OCTETS } from "../src/lib/email-i18n.ts";

describe("email-i18n validateEmail", () => {
  test("valid ASCII", () => {
    const result = validateEmail("user@example.com");
    expect(result.valid).toBe(true);
    expect(result.local).toBe("user");
    expect(result.domain).toBe("example.com");
    expect(result.errors).toEqual([]);
    expect(result.punycode).toBeUndefined();
  });

  test("valid UTF-8 local and IDN domain", () => {
    const result = validateEmail("用户@例子.com");
    expect(result.valid).toBe(true);
    expect(result.local).toBe("用户");
    expect(result.domain).toBe("例子.com");
    expect(result.punycode).toContain("xn--");
    expect(result.errors).toEqual([]);
  });

  test("invalid local part", () => {
    const result = validateEmail(".leading@example.com");
    expect(result.valid).toBe(false);
    expect(result.local).toBe(".leading");
    expect(result.domain).toBe("example.com");
    expect(result.errors.some((line) => line.includes("dot-atom"))).toBe(true);
  });

  test("invalid domain shape", () => {
    const result = validateEmail("user@a..b.com");
    expect(result.valid).toBe(false);
    expect(result.domain).toBe("a..b.com");
    expect(result.errors.some((line) => line.includes("consecutive dots"))).toBe(true);
  });

  test("punycode conversion for Unicode domain labels", () => {
    const result = validateEmail("user@mañana.com");
    expect(result.valid).toBe(true);
    expect(result.punycode).toBe("xn--maana-pta.com");
  });

  test("max local-part octet length", () => {
    const local = "a".repeat(LOCAL_PART_MAX_OCTETS + 1);
    const result = validateEmail(`${local}@example.com`);
    expect(result.valid).toBe(false);
    expect(result.errors.some((line) => line.includes("64 octets"))).toBe(true);
  });

  test("validateEmail stays within gate perf threshold", () => {
    const samples = ["user@example.com", "用户@例子.com", "user@mañana.com", ".bad@example.com"];
    const start = Bun.nanoseconds();
    for (let i = 0; i < 200; i++) {
      for (const email of samples) validateEmail(email);
    }
    const avgMs = (Bun.nanoseconds() - start) / 1_000_000 / (200 * samples.length);
    expect(avgMs).toBeLessThan(EMAIL_I18N_GATE_THRESHOLD_MS);
  });
});
