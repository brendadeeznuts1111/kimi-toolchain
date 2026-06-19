// ── URL / URLSearchParams ──────────────────────────────────────────

export async function apiUrl(): Promise<Response> {
  const url = new URL(
    "https://user:pass@example.com:8080/path/to/page?q=bun&lang=en&q=again#section"
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
    note: "URL.parse() returns null on invalid input (no throw). URL.canParse() is a fast boolean check. URLSearchParams: get, getAll, has, size, sort, entries.",
  });
}
