/**
 * Internationalized email address probes — local/domain split, octet limits, IDN domain handling.
 *
 * Reuses `normalizeHostnameAscii` + `decodeHostnameUnicode` from url-decomposer (same as url-i18n).
 *
 * **Limitations (by design):**
 * - No full RFC 6531 / RFC 5322 parsing
 * - NFC normalization enforced on local part (not full RFC 6531)
 * - No quoted-string or comment handling
 * - Focuses on common real-world i18n issues: `@` splitting, UTF-8 octet lengths, Punycode domains
 */
import { decodeHostnameUnicode, normalizeHostnameAscii } from "./url-decomposer.ts";

export const LOCAL_PART_MAX_OCTETS = 64;
export const DOMAIN_MAX_OCTETS = 253;

export type EmailProbeStatus = "pass" | "invalid" | "fail";
export type EmailExpectation = "valid" | "invalid";

export interface EmailI18nFixture {
  email: string;
  expect: EmailExpectation;
  /** When `expect: "invalid"`, probe `reason` must include this substring. */
  invalidReason?: string;
}

export const EMAIL_I18N_FIXTURES: readonly EmailI18nFixture[] = [
  { email: "user@example.com", expect: "valid" },
  { email: "用户@例子.com", expect: "valid" },
  { email: "münchen@deutschland.de", expect: "valid" },
  { email: "test@mañana.com", expect: "valid" },
  { email: "☃@☃.com", expect: "valid" },
  { email: "user@xn--fsqu00a.xn--0zwm56d", expect: "valid" },
  { email: "user@mañana.com", expect: "valid" },
  { email: "user.name+tag@sub.domain.com", expect: "valid" },
  { email: "user@invalid@domain.com", expect: "invalid", invalidReason: "Multiple @" },
  { email: "@nodomain.com", expect: "invalid", invalidReason: "Empty local" },
  { email: "nouser@", expect: "invalid", invalidReason: "Empty domain" },
  { email: "", expect: "invalid", invalidReason: "Missing @" },
] as const;

export const EMAIL_I18N_LIMITATIONS = [
  "No full RFC 6531 parsing",
  "NFC normalization only on local part (not NFD/NFKC)",
  "No quoted-string or comment handling",
  "IDN domain via punycode.toASCII + url.domainToUnicode only",
] as const;

export interface EmailI18nProbe {
  email: string;
  expect: EmailExpectation;
  status: EmailProbeStatus;
  /** True when observed status matches fixture expectation. */
  ok: boolean;
  reason?: string;
  local?: string;
  domain?: string;
  asciiDomain?: string;
  unicodeDomain?: string;
  localHasUnicode?: boolean;
  localOctets?: number;
  domainOctets?: number;
  lengthValid?: boolean;
  domainIdempotent?: boolean;
  domainError?: string | null;
  localPartError?: string | null;
}

export interface EmailI18nAudit {
  ok: boolean;
  summary: { total: number; passed: number; failed: number };
  lengthValid: boolean;
  domainIdempotent: boolean;
  localPartValid: boolean;
  probes: EmailI18nProbe[];
  limitations: readonly string[];
}

export interface EmailValidationResult {
  valid: boolean;
  local: string;
  domain: string;
  /** ASCII hostname (Punycode labels) when the domain encodes IDN or differs from Unicode input. */
  punycode?: string;
  errors: string[];
}

function localPartHasUnicode(local: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[^\u0000-\u007F]/.test(local);
}

/** Lightweight domain-part rules — not full RFC 5322 / RFC 6531. */
export function validateEmailDomain(domain: string): string | null {
  if (octetLength(domain) > DOMAIN_MAX_OCTETS) {
    return `domain exceeds ${DOMAIN_MAX_OCTETS} octets`;
  }
  if (domain.startsWith(".") || domain.endsWith(".")) return "domain boundary violation";
  if (domain.includes("..")) return "domain contains consecutive dots";
  const labels = domain.split(".");
  if (labels.some((label) => !label)) return "empty domain label";
  return null;
}

/** Lightweight local-part rules — not full RFC 6531. */
export function validateEmailLocalPart(local: string): string | null {
  if (octetLength(local) > LOCAL_PART_MAX_OCTETS) {
    return "local-part exceeds 64 octets";
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(local)) return "control characters disallowed";
  if (local !== local.normalize("NFC")) return "not in NFC form";
  if (local.startsWith(".") || local.endsWith(".")) return "dot-atom boundary violation";
  if (local.includes("..")) return "consecutive dots";
  return null;
}

function octetLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function matchesExpectation(probe: EmailI18nProbe, fixture: EmailI18nFixture): boolean {
  if (fixture.expect === "valid") return probe.status === "pass";
  if (probe.status !== "invalid") return false;
  if (!fixture.invalidReason) return true;
  return (probe.reason ?? "").includes(fixture.invalidReason);
}

/**
 * Validate email structure: `@` split, UTF-8 local part, IDN domain via punycode.toASCII.
 * Not a full RFC 5322 parser — see {@link EMAIL_I18N_LIMITATIONS}.
 */
export function validateEmail(email: string): EmailValidationResult {
  const errors: string[] = [];
  const atCount = (email.match(/@/g) ?? []).length;

  if (atCount === 0) {
    return { valid: false, local: "", domain: "", errors: ["Missing @"] };
  }
  if (atCount > 1) {
    return { valid: false, local: "", domain: "", errors: ["Multiple @ signs"] };
  }

  const at = email.indexOf("@");
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);

  if (!local) errors.push("Empty local part");
  if (!domain) errors.push("Empty domain part");
  if (!local || !domain) {
    return { valid: false, local, domain, errors };
  }

  const localPartError = validateEmailLocalPart(local);
  if (localPartError) errors.push(localPartError);

  const domainShapeError = validateEmailDomain(domain);
  if (domainShapeError) errors.push(domainShapeError);

  let punycode: string | undefined;
  if (!domainShapeError) {
    try {
      punycode = normalizeHostnameAscii(domain);
      if (normalizeHostnameAscii(punycode) !== punycode) {
        errors.push("Domain not idempotent under punycode.toASCII");
      }
      if (octetLength(punycode) > DOMAIN_MAX_OCTETS) {
        errors.push(`domain exceeds ${DOMAIN_MAX_OCTETS} octets`);
      }
    } catch (error: unknown) {
      errors.push(`Domain error: ${error instanceof Error ? error.message : Bun.inspect(error)}`);
    }
  }

  const showPunycode = punycode && punycode !== domain.trim().toLowerCase();

  return {
    valid: errors.length === 0,
    local,
    domain,
    ...(showPunycode ? { punycode } : {}),
    errors,
  };
}

/** Probe a single email address against structural + i18n rules. */
export function probeEmailI18n(fixture: EmailI18nFixture): EmailI18nProbe {
  const email = fixture.email;
  const atCount = (email.match(/@/g) ?? []).length;

  if (atCount === 0) {
    const probe: EmailI18nProbe = {
      email,
      expect: fixture.expect,
      status: "invalid",
      ok: false,
      reason: "Missing @",
    };
    probe.ok = matchesExpectation(probe, fixture);
    return probe;
  }

  if (atCount > 1) {
    const probe: EmailI18nProbe = {
      email,
      expect: fixture.expect,
      status: "invalid",
      ok: false,
      reason: "Multiple @ signs",
    };
    probe.ok = matchesExpectation(probe, fixture);
    return probe;
  }

  const at = email.indexOf("@");
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);

  if (!local || !domain) {
    const probe: EmailI18nProbe = {
      email,
      expect: fixture.expect,
      status: "invalid",
      ok: false,
      reason: !local ? "Empty local part" : "Empty domain part",
      local: local || undefined,
      domain: domain || undefined,
    };
    probe.ok = matchesExpectation(probe, fixture);
    return probe;
  }

  const localOctets = octetLength(local);
  let asciiDomain = "";
  let domainError: string | null = null;

  try {
    asciiDomain = normalizeHostnameAscii(domain);
  } catch (e: unknown) {
    domainError = e instanceof Error ? e.message : Bun.inspect(e);
  }

  const domainOctets = octetLength(asciiDomain);
  const lengthValid = localOctets <= LOCAL_PART_MAX_OCTETS && domainOctets <= DOMAIN_MAX_OCTETS;

  let unicodeDomain = "";
  let domainIdempotent = false;

  if (!domainError) {
    try {
      unicodeDomain = decodeHostnameUnicode(asciiDomain);
      domainIdempotent = normalizeHostnameAscii(asciiDomain) === asciiDomain;
    } catch {
      domainIdempotent = false;
    }
  }

  const localHasUnicode = localPartHasUnicode(local);
  const localPartError = validateEmailLocalPart(local);
  const structurallyValid =
    !domainError && domainIdempotent && lengthValid && localPartError === null;

  const probe: EmailI18nProbe = {
    email,
    expect: fixture.expect,
    status: structurallyValid ? "pass" : "fail",
    ok: false,
    local,
    domain,
    asciiDomain,
    unicodeDomain,
    localHasUnicode,
    localOctets,
    domainOctets,
    lengthValid,
    domainIdempotent,
    domainError,
    localPartError,
    ...(structurallyValid
      ? {}
      : {
          reason: localPartError
            ? localPartError
            : domainError
              ? `Domain error: ${domainError}`
              : !lengthValid
                ? `Length exceeded (local≤${LOCAL_PART_MAX_OCTETS}, domain≤${DOMAIN_MAX_OCTETS})`
                : !domainIdempotent
                  ? "Domain not idempotent under punycode.toASCII"
                  : "Validation failed",
        }),
  };
  probe.ok = matchesExpectation(probe, fixture);
  return probe;
}

/** Run all email-i18n fixtures — gate passes when every probe matches its expectation. */
export function auditEmailI18n(
  fixtures: readonly EmailI18nFixture[] = EMAIL_I18N_FIXTURES
): EmailI18nAudit {
  const probes = fixtures.map(probeEmailI18n);
  const passed = probes.filter((row) => row.ok).length;
  const failed = probes.length - passed;
  const validProbes = probes.filter((row) => row.expect === "valid");
  return {
    ok: failed === 0,
    summary: { total: probes.length, passed, failed },
    lengthValid: validProbes.every((row) => row.lengthValid !== false),
    domainIdempotent: validProbes.every((row) => row.domainIdempotent !== false),
    localPartValid: validProbes.every((row) => !row.localPartError),
    probes,
    limitations: EMAIL_I18N_LIMITATIONS,
  };
}
