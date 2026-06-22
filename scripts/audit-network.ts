#!/usr/bin/env bun
/**
 * audit-network.ts — NO_PROXY / proxy bypass checks for doctor gates.
 *
 * Usage:
 *   bun run audit:network
 *   bun run audit:network --dry-run
 */

import { join } from "path";
import { resolveFetchProxyMode } from "../src/lib/network-config.ts";

const ROOT = join(import.meta.dir, "..");
const JSON_MODE = process.argv.includes("--json");
const DRY_RUN = process.argv.includes("--dry-run");
const STRICT = process.argv.includes("--strict");

const INTERNAL_URLS = ["http://localhost/health", "http://127.0.0.1/health", "http://[::1]/health"];

interface NetworkFinding {
  url: string;
  mode: "direct" | "proxy";
  expected: "direct";
}

function auditNetwork(env: Record<string, string | undefined> = Bun.env): NetworkFinding[] {
  const findings: NetworkFinding[] = [];
  for (const url of INTERNAL_URLS) {
    const mode = resolveFetchProxyMode(url, env);
    if (mode !== "direct") {
      findings.push({ url, mode, expected: "direct" });
    }
  }
  return findings;
}

function hasNoProxy(env: Record<string, string | undefined>): boolean {
  return Boolean(env.NO_PROXY?.trim() || env.no_proxy?.trim());
}

async function main(): Promise<number> {
  if (DRY_RUN) {
    const summary = {
      tool: "audit-network",
      mode: "dry-run",
      projectRoot: ROOT,
      wouldCheck: INTERNAL_URLS,
    };
    if (JSON_MODE) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(
        `audit:network dry-run — would verify NO_PROXY bypass for ${INTERNAL_URLS.length} URL(s)`
      );
    }
    return 0;
  }

  if (!hasNoProxy(Bun.env)) {
    const message =
      "audit:network — NO_PROXY not configured; internal host bypass check skipped (use --strict to fail)";
    if (JSON_MODE) {
      console.log(JSON.stringify({ skipped: true, reason: message }, null, 2));
    } else {
      console.log(message);
    }
    return STRICT ? 1 : 0;
  }

  const findings = auditNetwork();

  if (JSON_MODE) {
    console.log(JSON.stringify({ findings, count: findings.length }, null, 2));
  } else if (findings.length === 0) {
    console.log("audit:network — internal hosts bypass proxy");
  } else {
    console.log(`audit:network — ${findings.length} bypass issue(s):`);
    for (const finding of findings) {
      console.log(`  ${finding.url} resolved to ${finding.mode} (expected ${finding.expected})`);
    }
  }

  return findings.length;
}

process.exit(await main());
