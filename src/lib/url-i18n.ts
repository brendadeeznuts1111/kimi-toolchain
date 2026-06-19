/**
 * IDN / Punycode validation — SSOT wraps `url-decomposer` + `node:punycode`.
 * @see url-decomposer.ts — normalizeHostnameAscii, decodeHostnameUnicode, decomposeUrl
 */
import {
  BUN_DOMAIN_TO_UNICODE_DOC_URL,
  BUN_PUNYCODE_DECODE_DOC_URL,
  BUN_PUNYCODE_ENCODE_DOC_URL,
  BUN_PUNYCODE_TO_ASCII_DOC_URL,
  decodeHostnameUnicode,
  decodePunycodeLabel,
  decomposeUrl,
  encodePunycodeLabel,
  normalizeHostnameAscii,
  punycodeLabelToAsciiLabel,
} from "./url-decomposer.ts";

export interface UrlI18nDomainProbe {
  domain: string;
  ascii: string;
  display: string;
  idempotent: boolean;
  roundtrip: boolean;
  /** True when a non-ASCII input produced at least one `xn--` label in ASCII form. */
  punycodeEncoded: boolean;
  /** Alias for `punycodeEncoded` — non-ASCII hostnames must encode to an `xn--` label. */
  punycodePrefixCorrect: boolean;
}

export const URL_I18N_DOMAIN_FIXTURES = [
  "example.com",
  "mañana.com",
  "☃-⌘.com",
  "xn--maana-pta.com",
  "bücher.de",
  "münchen.de",
  `${"a".repeat(63)}.com`,
  "",
  "xn--",
] as const;

/** Single-label encode/decode fixtures (punycode body, no `xn--`). */
export const URL_I18N_LABEL_FIXTURES = ["mañana", "☃-⌘", "example"] as const;

export interface UrlI18nLabelProbe {
  unicode: string;
  encoded: string;
  decoded: string;
  asciiLabel: string;
  roundtrip: boolean;
}

function hostnameHasNonAscii(hostname: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[^\u0000-\u007F]/.test(hostname);
}

function asciiHasPunycodeLabel(ascii: string): boolean {
  return ascii.split(".").some((label) => label.toLowerCase().startsWith("xn--"));
}

function roundtripDomain(original: string, ascii: string, display: string): boolean {
  if (!original && !ascii && !display) return true;
  return display === original || ascii === original;
}

/** Probe a single domain label string (host, not full URL). */
export function probeUrlI18nDomain(domain: string): UrlI18nDomainProbe {
  const ascii = normalizeHostnameAscii(domain);
  const display = decodeHostnameUnicode(ascii);
  const idempotent = normalizeHostnameAscii(ascii) === ascii;
  const roundtrip = roundtripDomain(domain, ascii, display);
  const punycodeEncoded = !hostnameHasNonAscii(domain) || asciiHasPunycodeLabel(ascii);
  return {
    domain,
    ascii,
    display,
    idempotent,
    roundtrip,
    punycodeEncoded,
    punycodePrefixCorrect: punycodeEncoded,
  };
}

export interface UrlI18nAbsoluteProbe {
  url: string;
  hostnameAscii: string;
  display: string;
}

export interface UrlI18nAudit {
  ok: boolean;
  idempotent: boolean;
  roundtrip: boolean;
  punycodeEncoded: boolean;
  /** Alias for `punycodeEncoded` (gate/dashboard contract). */
  punycodePrefixCorrect: boolean;
  probes: UrlI18nDomainProbe[];
  labelProbes: UrlI18nLabelProbe[];
  urlProbes: UrlI18nAbsoluteProbe[];
  docs: { toASCII: string; encode: string; decode: string; domainToUnicode: string };
}

/** Probe punycode.encode / decode on a single label. */
export function probeUrlI18nLabel(unicode: string): UrlI18nLabelProbe {
  const encoded = encodePunycodeLabel(unicode);
  const decoded = decodePunycodeLabel(encoded);
  const asciiLabel = punycodeLabelToAsciiLabel(unicode);
  return {
    unicode,
    encoded,
    decoded,
    asciiLabel,
    roundtrip: decoded === unicode,
  };
}

/** Local punycode audit — no network I/O. */
export function auditUrlI18n(): UrlI18nAudit {
  const probes = URL_I18N_DOMAIN_FIXTURES.map(probeUrlI18nDomain);
  const labelProbes = URL_I18N_LABEL_FIXTURES.map(probeUrlI18nLabel);
  const idempotent = probes.every((row) => row.idempotent);
  const roundtrip =
    probes.every((row) => row.roundtrip) && labelProbes.every((row) => row.roundtrip);
  const punycodeEncoded = probes.every((row) => row.punycodeEncoded);
  const urlProbes: UrlI18nAbsoluteProbe[] = [
    "https://mañana.com/path?q=1",
    "https://example.com/health",
  ].map((url) => {
    const parts = decomposeUrl(url);
    return {
      url,
      hostnameAscii: parts.hostname,
      display: decodeHostnameUnicode(parts.hostname),
    };
  });
  return {
    ok: idempotent && roundtrip && punycodeEncoded,
    idempotent,
    roundtrip,
    punycodeEncoded,
    punycodePrefixCorrect: punycodeEncoded,
    probes,
    labelProbes,
    urlProbes,
    docs: {
      toASCII: BUN_PUNYCODE_TO_ASCII_DOC_URL,
      encode: BUN_PUNYCODE_ENCODE_DOC_URL,
      decode: BUN_PUNYCODE_DECODE_DOC_URL,
      domainToUnicode: BUN_DOMAIN_TO_UNICODE_DOC_URL,
    },
  };
}

/** Resolve absolute URL hostname to ASCII (for probe/fetch layers). */
export function resolveUrlHostnameAscii(url: string): string {
  return decomposeUrl(url).hostname;
}
