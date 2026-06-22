// ── URL / URLSearchParams ──────────────────────────────────────────

import { jsonResponse } from "./api-handlers.ts";

export async function apiUrl(): Promise<Response> {
  const url = new URL(
    "https://user:pass@example.com:8080/path/to/page?q=bun&lang=en&q=again#section" // kimi-audit:ignore-hardcoded-secret (URL parsing example)
  );

  // All parsed properties
  const properties = {
    href: url.href,
    origin: url.origin,
    protocol: url.protocol,
    username: url.username,
    password: url.password,
    host: url.host,
    hostname: url.hostname,
    port: url.port,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
  };

  // URLSearchParams manipulation
  const sp = url.searchParams;
  const params = {
    get_q: sp.get("q"),
    getAll_q: sp.getAll("q"),
    has_lang: sp.has("lang"),
    size: sp.size,
    toString: sp.toString(),
  };

  // Static methods
  const canParseValid = URL.canParse("https://bun.sh/docs");
  const canParseInvalid = URL.canParse("not-a-url");
  const parsed = URL.parse("/docs", "https://bun.sh");
  const parsedInvalid = URL.parse("not-a-url");

  // Relative resolution
  const relative = new URL("../../api", "https://example.com/a/b/c/page");

  const { auditUrlI18n } = await import("../../../../src/lib/url-i18n.ts");
  const { auditEmailI18n } = await import("../../../../src/lib/email-i18n.ts");
  const i18n = auditUrlI18n();
  const emailI18n = auditEmailI18n();

  return jsonResponse({
    properties,
    searchParams: params,
    staticMethods: {
      canParse: { valid: canParseValid, invalid: canParseInvalid },
      parse: {
        withBase: parsed ? { href: parsed.href, pathname: parsed.pathname } : null,
        invalid: parsedInvalid,
      },
    },
    relativeResolution: {
      input: "../../api",
      base: "https://example.com/a/b/c/page",
      result: relative.href,
    },
    i18n: {
      ok: i18n.ok,
      idempotent: i18n.idempotent,
      roundtrip: i18n.roundtrip,
      punycodePrefixCorrect: i18n.punycodePrefixCorrect,
      domains: i18n.probes,
      labels: i18n.labelProbes,
      urls: i18n.urlProbes,
      gate: "url-i18n",
      docs: i18n.docs,
    },
    emailI18n: {
      ok: emailI18n.ok,
      summary: emailI18n.summary,
      lengthValid: emailI18n.lengthValid,
      domainIdempotent: emailI18n.domainIdempotent,
      emails: emailI18n.probes,
      limitations: emailI18n.limitations,
      gates: ["url-i18n", "email-i18n"],
    },
    note: "URL.parse() returns null on invalid input (no throw). URL.canParse() is a fast boolean check. URLSearchParams: get, getAll, has, size, sort, entries. i18n: node:punycode via src/lib/url-decomposer.ts. email-i18n: @ split + UTF-8 octet limits + IDN domain (gates: url-i18n, email-i18n).",
  });
}
