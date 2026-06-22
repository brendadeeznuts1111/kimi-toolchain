/**
 * Network policy — NO_PROXY / proxy bypass for doctor network audits.
 */

function parseNoProxy(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

/** Strip brackets and port from a host string, preserving IPv6 addresses. */
function normalizeHost(host: string): string {
  let normalized = host.toLowerCase().replace(/^\[|\]$/g, ""); // IPv6 literal brackets
  // If it looks like an IPv6 address, do not strip colons.
  if (normalized.includes(":")) {
    const segments = normalized.split(":");
    // IPv6 has more than one colon-separated segment and at least one empty segment ("::").
    if (segments.length > 2 && segments.some((s) => s === "")) return normalized;
    // Otherwise treat the last segment as a port if it is numeric.
    const last = segments.at(-1);
    if (last && /^\d+$/.test(last)) {
      normalized = segments.slice(0, -1).join(":");
    }
  }
  return normalized;
}

/** True when `host` matches NO_PROXY / no_proxy (exact or `*` suffix). */
export function shouldBypassProxy(
  host: string,
  env: Record<string, string | undefined> = Bun.env
): boolean {
  const normalized = normalizeHost(host);
  const rules = [...parseNoProxy(env.NO_PROXY), ...parseNoProxy(env.no_proxy)];
  if (rules.includes("*")) return true;
  return rules.some((rule) => {
    const bare = rule.startsWith(".") ? rule.slice(1) : rule;
    return normalized === bare || normalized.endsWith(`.${bare}`);
  });
}

/** Effective fetch proxy mode for audits — `direct` when bypass applies. */
export function resolveFetchProxyMode(
  url: string,
  env: Record<string, string | undefined> = Bun.env
): "direct" | "proxy" {
  try {
    const host = new URL(url).hostname;
    return shouldBypassProxy(host, env) ? "direct" : "proxy";
  } catch {
    return "proxy";
  }
}
