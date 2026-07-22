/**
 * security-scanner.unit.test.ts — OSV advisory mapping, outage degradation, bunfig wiring.
 *
 * No network: the fetch boundary is injected (see `ScannerFetch`).
 * No subprocess: the Bun scanner entry is covered by wiring assertions only.
 */

import { describe, expect, test } from "bun:test";
import {
  classifyVuln,
  cvss3BaseScore,
  OSV_QUERY_BATCH_URL,
  OSV_VULN_URL_BASE,
  scanPackages,
  SCANNER_DEFAULT_TIMEOUT_MS,
  type OsvVuln,
  type ScannerFetch,
} from "../src/lib/security-scanner.ts";
import { safeToml } from "../src/lib/utils.ts";
import { REPO_ROOT } from "./helpers.ts";

// ── Fixtures ───────────────────────────────────────────────────────────

function pkg(name: string, version: string): Bun.Security.Package {
  return {
    name,
    version,
    tarball: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`,
    requestedRange: version,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface FakeCall {
  url: string;
  options: RequestInit & { timeoutMs?: number };
}

/**
 * Two-call OSV fake: `/v1/querybatch` answers with id-only stubs (matching the real
 * API), `/v1/vulns/{id}` answers from `vulnMap`. `onBatch` overrides the batch
 * response entirely (for outage cases).
 */
function fakeOsv(
  batchBody: unknown,
  vulnMap: Record<string, unknown> = {},
  opts: { onBatch?: (call: FakeCall) => Response; vulnStatus?: number } = {}
) {
  const calls: FakeCall[] = [];
  const fetchFn: ScannerFetch = (url, options) => {
    const call: FakeCall = { url, options };
    calls.push(call);
    if (url === OSV_QUERY_BATCH_URL) {
      return Promise.resolve(opts.onBatch ? opts.onBatch(call) : jsonResponse(batchBody));
    }
    if (url.startsWith(OSV_VULN_URL_BASE)) {
      const id = url.slice(OSV_VULN_URL_BASE.length);
      const vuln = vulnMap[id];
      const status = opts.vulnStatus ?? (vuln ? 200 : 404);
      return Promise.resolve(jsonResponse(vuln ?? { error: "not found" }, status));
    }
    return Promise.resolve(jsonResponse({ error: "unexpected url" }, 500));
  };
  return { fetchFn, calls };
}

function stub(id: string): { id: string } {
  return { id };
}

const HIGH_WITH_FIX: OsvVuln = {
  id: "GHSA-jf85-cpcp-j695",
  summary: "Prototype pollution in lodash",
  aliases: ["CVE-2020-8203"],
  severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:H" }],
  affected: [{ ranges: [{ events: [{ introduced: "0" }, { fixed: "4.17.12" }] }] }],
  database_specific: { severity: "HIGH" },
};

// ── Tests ──────────────────────────────────────────────────────────────

describe("security-scanner", () => {
  describe("advisory mapping", () => {
    test("returns no advisories and skips fetch when package list is empty", async () => {
      const { fetchFn, calls } = fakeOsv({ results: [] });
      const advisories = await scanPackages([], { fetchFn });
      expect(advisories).toEqual([]);
      expect(calls).toHaveLength(0);
    });

    test("maps critical severity with a fix available to fatal", async () => {
      const { fetchFn } = fakeOsv(
        { results: [{ vulns: [stub(HIGH_WITH_FIX.id)] }] },
        { [HIGH_WITH_FIX.id]: HIGH_WITH_FIX }
      );
      const advisories = await scanPackages([pkg("lodash", "4.17.11")], { fetchFn });
      expect(advisories).toHaveLength(1);
      expect(advisories[0]?.level).toBe("fatal");
      expect(advisories[0]?.package).toBe("lodash");
      expect(advisories[0]?.url).toBe("https://osv.dev/vulnerability/GHSA-jf85-cpcp-j695");
      expect(advisories[0]?.description).toContain("CVE-2020-8203");
    });

    test("maps known-exploited vulnerabilities to fatal even without high severity", async () => {
      const exploited: OsvVuln = {
        id: "GHSA-exploited-0001",
        affected: [],
        database_specific: { severity: "MODERATE", cisa_known_exploited: true },
      };
      const { fetchFn } = fakeOsv(
        { results: [{ vulns: [stub(exploited.id)] }] },
        { [exploited.id]: exploited }
      );
      const advisories = await scanPackages([pkg("left-pad", "1.0.0")], { fetchFn });
      expect(advisories[0]?.level).toBe("fatal");
    });

    test("maps moderate severity to warn even when a fix exists", async () => {
      const moderate: OsvVuln = {
        ...HIGH_WITH_FIX,
        id: "GHSA-moderate-0001",
        database_specific: { severity: "MODERATE" },
      };
      const { fetchFn } = fakeOsv(
        { results: [{ vulns: [stub(moderate.id)] }] },
        { [moderate.id]: moderate }
      );
      const advisories = await scanPackages([pkg("minimist", "1.2.5")], { fetchFn });
      expect(advisories[0]?.level).toBe("warn");
    });

    test("maps high severity without a published fix to warn", async () => {
      const noFix: OsvVuln = {
        ...HIGH_WITH_FIX,
        id: "GHSA-nofix-0001",
        affected: [{ ranges: [{ events: [{ introduced: "0" }] }] }],
      };
      const { fetchFn } = fakeOsv(
        { results: [{ vulns: [stub(noFix.id)] }] },
        { [noFix.id]: noFix }
      );
      const advisories = await scanPackages([pkg("lodash", "4.17.11")], { fetchFn });
      expect(advisories[0]?.level).toBe("warn");
    });

    test("falls back to the CVSS vector when OSV carries no severity label", async () => {
      const vectorOnly: OsvVuln = {
        ...HIGH_WITH_FIX,
        id: "GHSA-vector-0001",
        database_specific: {},
      };
      expect(classifyVuln(vectorOnly)).toBe("fatal");
    });

    test("returns no advisories and skips hydration when OSV reports no vulnerabilities", async () => {
      const { fetchFn, calls } = fakeOsv({ results: [{}, { vulns: [] }] });
      const advisories = await scanPackages([pkg("a", "1.0.0"), pkg("b", "2.0.0")], { fetchFn });
      expect(advisories).toEqual([]);
      expect(calls).toHaveLength(1);
    });

    test("aligns batch results to packages by index", async () => {
      const { fetchFn } = fakeOsv(
        { results: [{ vulns: [] }, { vulns: [stub(HIGH_WITH_FIX.id)] }] },
        { [HIGH_WITH_FIX.id]: HIGH_WITH_FIX }
      );
      const advisories = await scanPackages([pkg("clean", "1.0.0"), pkg("lodash", "4.17.11")], {
        fetchFn,
      });
      expect(advisories).toHaveLength(1);
      expect(advisories[0]?.package).toBe("lodash");
    });

    test("degrades unhydrated stubs to warn with an id-only description", async () => {
      const outages: string[] = [];
      const { fetchFn } = fakeOsv(
        { results: [{ vulns: [stub("GHSA-gone-0001")] }] },
        {},
        { vulnStatus: 500 }
      );
      const advisories = await scanPackages([pkg("lodash", "4.17.11")], {
        fetchFn,
        onOutage: (m) => outages.push(m),
      });
      expect(advisories).toHaveLength(1);
      expect(advisories[0]?.level).toBe("warn");
      expect(advisories[0]?.description).toContain("GHSA-gone-0001");
      expect(outages.some((m) => m.includes("hydration failed"))).toBe(true);
    });
  });

  describe("request contract", () => {
    test("posts one querybatch request with npm ecosystem and exact versions", async () => {
      const { fetchFn, calls } = fakeOsv({ results: [{ vulns: [] }, { vulns: [] }] });
      await scanPackages([pkg("lodash", "4.17.11"), pkg("is-odd", "3.0.1")], { fetchFn });
      expect(calls).toHaveLength(1);
      const call = calls[0];
      expect(call?.url).toBe(OSV_QUERY_BATCH_URL);
      expect(call?.options.method).toBe("POST");
      expect(call?.options.timeoutMs).toBe(SCANNER_DEFAULT_TIMEOUT_MS);
      expect(JSON.parse(String(call?.options.body))).toEqual({
        queries: [
          { package: { name: "lodash", ecosystem: "npm" }, version: "4.17.11" },
          { package: { name: "is-odd", ecosystem: "npm" }, version: "3.0.1" },
        ],
      });
    });

    test("hydrates each unique vuln id exactly once", async () => {
      const { fetchFn, calls } = fakeOsv(
        { results: [{ vulns: [stub(HIGH_WITH_FIX.id)] }, { vulns: [stub(HIGH_WITH_FIX.id)] }] },
        { [HIGH_WITH_FIX.id]: HIGH_WITH_FIX }
      );
      await scanPackages([pkg("a", "1.0.0"), pkg("b", "2.0.0")], { fetchFn });
      const detailCalls = calls.filter((c) => c.url.startsWith(OSV_VULN_URL_BASE));
      expect(detailCalls).toHaveLength(1);
      expect(detailCalls[0]?.url).toBe(`${OSV_VULN_URL_BASE}${HIGH_WITH_FIX.id}`);
    });

    test("forwards a custom timeout to both batch and detail requests", async () => {
      const { fetchFn, calls } = fakeOsv(
        { results: [{ vulns: [stub(HIGH_WITH_FIX.id)] }] },
        { [HIGH_WITH_FIX.id]: HIGH_WITH_FIX }
      );
      await scanPackages([pkg("lodash", "4.17.11")], { fetchFn, timeoutMs: 1500 });
      expect(calls).toHaveLength(2);
      expect(calls.every((c) => c.options.timeoutMs === 1500)).toBe(true);
    });
  });

  describe("outage degradation", () => {
    test("degrades to a warn advisory and logs when fetch rejects (timeout/abort)", async () => {
      const { fetchFn } = fakeOsv(
        {},
        {},
        {
          onBatch: () => {
            throw new DOMException("The operation was aborted", "AbortError");
          },
        }
      );
      const outages: string[] = [];
      const advisories = await scanPackages([pkg("lodash", "4.17.11")], {
        fetchFn,
        onOutage: (m) => outages.push(m),
      });
      expect(advisories).toHaveLength(1);
      expect(advisories[0]?.level).toBe("warn");
      expect(advisories[0]?.description).toContain("OSV unreachable");
      expect(outages).toHaveLength(1);
      expect(outages[0]).toContain("aborted");
    });

    test("degrades to a warn advisory on non-2xx OSV responses", async () => {
      const { fetchFn } = fakeOsv({}, {}, { onBatch: () => jsonResponse({ error: "boom" }, 503) });
      const advisories = await scanPackages([pkg("lodash", "4.17.11")], { fetchFn });
      expect(advisories[0]?.level).toBe("warn");
      expect(advisories[0]?.description).toContain("503");
    });

    test("degrades to a warn advisory on malformed OSV payloads", async () => {
      const { fetchFn } = fakeOsv({ unexpected: true });
      const advisories = await scanPackages([pkg("lodash", "4.17.11")], { fetchFn });
      expect(advisories[0]?.level).toBe("warn");
      expect(advisories[0]?.description).toContain("malformed");
    });

    test("returns no advisories on outage when policy is ignore", async () => {
      const { fetchFn } = fakeOsv(
        {},
        {},
        {
          onBatch: () => {
            throw new Error("socket hangup");
          },
        }
      );
      const outages: string[] = [];
      const advisories = await scanPackages([pkg("lodash", "4.17.11")], {
        fetchFn,
        outagePolicy: "ignore",
        onOutage: (m) => outages.push(m),
      });
      expect(advisories).toEqual([]);
      expect(outages).toHaveLength(1);
    });
  });

  describe("cvss3BaseScore", () => {
    test("computes the canonical 9.8 critical score", () => {
      expect(cvss3BaseScore("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H")).toBe(9.8);
    });

    test("returns null for unparseable vectors", () => {
      expect(cvss3BaseScore("CVSS:3.1/AV:Z")).toBeNull();
      expect(cvss3BaseScore("not-a-vector")).toBeNull();
    });
  });

  describe("bunfig wiring", () => {
    test("repo bunfig.toml points install.security.scanner at the scanner entry", async () => {
      interface BunfigSecurity {
        install?: { security?: { scanner?: string } };
      }
      const text = await Bun.file(`${REPO_ROOT}/bunfig.toml`).text();
      const parsed = safeToml<BunfigSecurity>(
        text,
        {},
        (v): v is BunfigSecurity => typeof v === "object" && v !== null
      );
      expect(parsed.install?.security?.scanner).toBe(
        "./packages/bun-security-scanner/src/index.ts"
      );
      const entry = Bun.file(`${REPO_ROOT}/packages/bun-security-scanner/src/index.ts`);
      expect(await entry.exists()).toBe(true);
    });
  });
});
