/**
 * security-scanner.ts — OSV-backed advisory engine for Bun's install security scanner API.
 *
 * Pure core: no console, no process.env, no I/O beyond the injected fetch boundary.
 * The Bun-facing entry lives at `packages/bun-security-scanner/src/index.ts` and is
 * wired via `[install.security] scanner` in the repo `bunfig.toml`.
 *
 * Policy:
 * - `fatal` — known-exploited vulnerability, OR high/critical severity with a fix available.
 * - `warn`  — everything else, including scanner outage (never throw: a throw makes Bun
 *   cancel the install defensively; a warn lets interactive users decide).
 *
 * @see https://bun.com/docs/pm/security-scanner-api
 * @see https://google.github.io/osv.dev/post-v1-querybatch/
 */

export const OSV_QUERY_BATCH_URL = "https://api.osv.dev/v1/querybatch";

/** Short by design — this runs on the install path. */
export const SCANNER_DEFAULT_TIMEOUT_MS = 5000;

/** Fetch boundary, shaped like `fetchWithTimeout` from `src/lib/utils.ts`. */
export type ScannerFetch = (
  url: string,
  options: RequestInit & { timeoutMs?: number }
) => Promise<Response>;

export type OutagePolicy = "warn" | "ignore";

export interface SecurityScanOptions {
  /** Required fetch boundary (inject a fake in tests; production uses `fetchWithTimeout`). */
  fetchFn: ScannerFetch;
  timeoutMs?: number;
  /** What to do when OSV is unreachable. Default "warn" (never blocks like `fatal`). */
  outagePolicy?: OutagePolicy;
  /** Receives a human-readable line when the scan degrades (e.g. OSV outage). */
  onOutage?: (message: string) => void;
  /** Override the OSV batch endpoint (tests, mirrors). */
  osvUrl?: string;
  /** Override the OSV vuln detail endpoint base (tests, mirrors). */
  vulnUrlBase?: string;
}

// ── OSV response model (defensively narrowed) ─────────────────────────

export interface OsvVuln {
  id: string;
  summary?: string;
  aliases?: string[];
  severity?: Array<{ type?: string; score?: string }>;
  affected?: Array<{ ranges?: Array<{ events?: Array<Record<string, unknown>> }> }>;
  database_specific?: Record<string, unknown>;
}

interface OsvQueryResult {
  vulns?: OsvVuln[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((v): v is string => typeof v === "string");
  return out.length > 0 ? out : undefined;
}

function narrowVuln(value: unknown): OsvVuln | undefined {
  if (!isRecord(value) || typeof value.id !== "string") return undefined;
  const vuln: OsvVuln = { id: value.id };
  if (typeof value.summary === "string") vuln.summary = value.summary;
  const aliases = asStringArray(value.aliases);
  if (aliases) vuln.aliases = aliases;
  if (Array.isArray(value.severity)) {
    const severity = value.severity.filter(isRecord).map((s) => ({
      ...(typeof s.type === "string" ? { type: s.type } : {}),
      ...(typeof s.score === "string" ? { score: s.score } : {}),
    }));
    if (severity.length > 0) vuln.severity = severity;
  }
  if (Array.isArray(value.affected)) {
    vuln.affected = value.affected.filter(isRecord).map((a) => {
      if (!Array.isArray(a.ranges)) return {};
      return {
        ranges: a.ranges.filter(isRecord).map((r) => {
          if (!Array.isArray(r.events)) return {};
          return { events: r.events.filter(isRecord) };
        }),
      };
    });
  }
  if (isRecord(value.database_specific)) vuln.database_specific = value.database_specific;
  return vuln;
}

function parseBatchResponse(data: unknown): OsvQueryResult[] {
  if (!isRecord(data) || !Array.isArray(data.results)) {
    throw new Error("malformed OSV querybatch response: missing results array");
  }
  return data.results.map((r) => {
    if (!isRecord(r)) return {};
    if (!Array.isArray(r.vulns)) return {};
    return { vulns: r.vulns.map(narrowVuln).filter((v): v is OsvVuln => v !== undefined) };
  });
}

// ── CVSS 3.x base score (fallback when OSV carries no severity label) ─

const CVSS3_AV: Record<string, number> = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 };
const CVSS3_AC: Record<string, number> = { L: 0.77, H: 0.44 };
const CVSS3_PR_UNCHANGED: Record<string, number> = { N: 0.85, L: 0.62, H: 0.27 };
const CVSS3_PR_CHANGED: Record<string, number> = { N: 0.85, L: 0.68, H: 0.5 };
const CVSS3_UI: Record<string, number> = { N: 0.85, R: 0.62 };
const CVSS3_IMPACT: Record<string, number> = { H: 0.56, L: 0.22, N: 0 };

/** Compute the CVSS 3.x base score from a vector string; null when unparseable. */
export function cvss3BaseScore(vector: string): number | null {
  const metrics = new Map<string, string>();
  for (const part of vector.split("/")) {
    const [key, val] = part.split(":");
    if (key && val) metrics.set(key, val);
  }
  const scopeChanged = metrics.get("S") === "C";
  const av = CVSS3_AV[metrics.get("AV") ?? ""];
  const ac = CVSS3_AC[metrics.get("AC") ?? ""];
  const pr = (scopeChanged ? CVSS3_PR_CHANGED : CVSS3_PR_UNCHANGED)[metrics.get("PR") ?? ""];
  const ui = CVSS3_UI[metrics.get("UI") ?? ""];
  const c = CVSS3_IMPACT[metrics.get("C") ?? ""];
  const i = CVSS3_IMPACT[metrics.get("I") ?? ""];
  const a = CVSS3_IMPACT[metrics.get("A") ?? ""];
  if (
    av === undefined ||
    ac === undefined ||
    pr === undefined ||
    ui === undefined ||
    c === undefined ||
    i === undefined ||
    a === undefined ||
    metrics.get("S") === undefined
  ) {
    return null;
  }
  const isc = 1 - (1 - c) * (1 - i) * (1 - a);
  const impact = scopeChanged ? 7.52 * (isc - 0.029) - 3.25 * (isc - 0.02) ** 15 : 6.42 * isc;
  if (impact <= 0) return 0;
  const exploitability = 8.22 * av * ac * pr * ui;
  const raw = scopeChanged
    ? Math.min(1.08 * (impact + exploitability), 10)
    : Math.min(impact + exploitability, 10);
  return Math.ceil(raw * 10) / 10;
}

export type SeverityRank = "critical" | "high" | "medium" | "low" | "unknown";

/** Rank a vulnerability: OSV `database_specific.severity` label first, CVSS score second. */
export function severityRank(vuln: OsvVuln): SeverityRank {
  const label = vuln.database_specific?.severity;
  if (typeof label === "string") {
    switch (label.toUpperCase()) {
      case "CRITICAL":
        return "critical";
      case "HIGH":
        return "high";
      case "MODERATE":
      case "MEDIUM":
        return "medium";
      case "LOW":
        return "low";
    }
  }
  for (const entry of vuln.severity ?? []) {
    const score = entry.score ?? "";
    let base: number | null = null;
    if (score.startsWith("CVSS:3")) {
      base = cvss3BaseScore(score);
    } else {
      const numeric = Number.parseFloat(score);
      base = Number.isFinite(numeric) ? numeric : null;
    }
    if (base === null) continue;
    if (base >= 9.0) return "critical";
    if (base >= 7.0) return "high";
    if (base >= 4.0) return "medium";
    return "low";
  }
  return "unknown";
}

/** True when any affected range reports a `fixed` event (a patched version exists). */
export function hasFixAvailable(vuln: OsvVuln): boolean {
  for (const affected of vuln.affected ?? []) {
    for (const range of affected.ranges ?? []) {
      for (const event of range.events ?? []) {
        if (typeof event.fixed === "string") return true;
      }
    }
  }
  return false;
}

/** CISA KEV / known-exploited markers carried in OSV `database_specific`. */
export function isKnownExploited(vuln: OsvVuln): boolean {
  const db = vuln.database_specific;
  if (!db) return false;
  return db.cisa_known_exploited === true || db.known_exploited === true;
}

/** Advisory level policy: known-exploited or high/critical with a fix → fatal, else warn. */
export function classifyVuln(vuln: OsvVuln): "fatal" | "warn" {
  if (isKnownExploited(vuln)) return "fatal";
  const rank = severityRank(vuln);
  if ((rank === "critical" || rank === "high") && hasFixAvailable(vuln)) return "fatal";
  return "warn";
}

// ── Scan ──────────────────────────────────────────────────────────────

/** Detail endpoint — `/v1/querybatch` returns id-only stubs; full records come from here. */
export const OSV_VULN_URL_BASE = "https://api.osv.dev/v1/vulns/";

/** Cap on detail hydrations per scan so a vulnerable tree can't stall the install path. */
export const MAX_HYDRATED_VULNS = 50;

function outageAdvisory(
  packages: readonly Bun.Security.Package[],
  detail: string
): Bun.Security.Advisory {
  return {
    level: "warn",
    package: packages[0]?.name ?? "unknown",
    url: null,
    description: `Security scan incomplete — OSV unreachable (${detail}). Install proceeds without vulnerability data.`,
  };
}

/**
 * Fetch full vulnerability records for the id stubs returned by `/v1/querybatch`.
 * Individual failures are skipped (the stub still surfaces as a warn advisory);
 * this function never throws.
 */
async function hydrateVulns(
  ids: readonly string[],
  fetchFn: ScannerFetch,
  timeoutMs: number,
  vulnUrlBase: string
): Promise<Map<string, OsvVuln>> {
  const unique = [...new Set(ids)].slice(0, MAX_HYDRATED_VULNS);
  const entries = await Promise.all(
    unique.map(async (id) => {
      try {
        const resp = await fetchFn(`${vulnUrlBase}${id}`, { timeoutMs });
        if (!resp.ok) return undefined;
        const vuln = narrowVuln(await resp.json());
        return vuln ? ([id, vuln] as const) : undefined;
      } catch {
        return undefined;
      }
    })
  );
  return new Map(entries.filter((e): e is readonly [string, OsvVuln] => e !== undefined));
}

function describeVuln(pkg: Bun.Security.Package, vuln: OsvVuln): string {
  const cve = vuln.aliases?.find((a) => a.startsWith("CVE-"));
  const head = cve ? `${vuln.id} (${cve})` : vuln.id;
  const summary = vuln.summary ?? "no summary available";
  const fixed = hasFixAvailable(vuln) ? " Fix available." : " No fix published.";
  return `${head} [${severityRank(vuln)}] affects ${pkg.name}@${pkg.version}: ${summary}${fixed}`;
}

/**
 * Query OSV (`/v1/querybatch` + `/v1/vulns/{id}` hydration) for the exact resolved
 * package versions Bun is about to install and map vulnerabilities to `fatal`/`warn`
 * advisories.
 *
 * Never throws on network/parse failure — degrades to a single `warn` advisory
 * (or `[]` with `outagePolicy: "ignore"`) and reports through `onOutage`.
 */
export async function scanPackages(
  packages: readonly Bun.Security.Package[],
  options: SecurityScanOptions
): Promise<Bun.Security.Advisory[]> {
  if (packages.length === 0) return [];

  const timeoutMs = options.timeoutMs ?? SCANNER_DEFAULT_TIMEOUT_MS;
  const osvUrl = options.osvUrl ?? OSV_QUERY_BATCH_URL;
  const vulnUrlBase = options.vulnUrlBase ?? OSV_VULN_URL_BASE;

  let results: OsvQueryResult[];
  try {
    const resp = await options.fetchFn(osvUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        queries: packages.map((p) => ({
          package: { name: p.name, ecosystem: "npm" },
          version: p.version,
        })),
      }),
      timeoutMs,
    });
    if (!resp.ok) throw new Error(`OSV HTTP ${resp.status}`);
    results = parseBatchResponse(await resp.json());
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    options.onOutage?.(`OSV scan degraded (${detail}) — reporting warn, not blocking install`);
    if ((options.outagePolicy ?? "warn") === "ignore") return [];
    return [outageAdvisory(packages, detail)];
  }

  const stubs = results.flatMap((r) => r.vulns ?? []);
  const hydrated = await hydrateVulns(
    stubs.map((v) => v.id),
    options.fetchFn,
    timeoutMs,
    vulnUrlBase
  );
  if (stubs.length > 0 && hydrated.size === 0) {
    options.onOutage?.(
      `OSV detail hydration failed for ${stubs.length} vuln(s) — severity unknown, reporting warn`
    );
  }

  const advisories: Bun.Security.Advisory[] = [];
  for (let idx = 0; idx < packages.length; idx++) {
    const pkg = packages[idx];
    if (!pkg) continue;
    for (const stub of results[idx]?.vulns ?? []) {
      const vuln = hydrated.get(stub.id) ?? stub;
      advisories.push({
        level: classifyVuln(vuln),
        package: pkg.name,
        url: `https://osv.dev/vulnerability/${vuln.id}`,
        description: describeVuln(pkg, vuln),
      });
    }
  }
  return advisories;
}
