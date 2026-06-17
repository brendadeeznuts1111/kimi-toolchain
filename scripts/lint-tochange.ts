#!/usr/bin/env bun
/**
 * lint-tochange.ts — Grep and validate `.tochange` / `.implemented` markers.
 *
 * Usage:
 *   bun run lint:tochange
 *   bun run lint:tochange --json
 *   bun run lint:tochange --fail-on-pending
 */

import { join } from "path";
import {
  auditPeekAdoption,
  formatTochangeReport,
  PEEK_ADOPTION_REGISTRY,
} from "../src/lib/tochange-tracker.ts";

const REPO_ROOT = join(import.meta.dir, "..");
const json = Bun.argv.includes("--json");
const failOnPending = Bun.argv.includes("--fail-on-pending");

async function main(): Promise<number> {
  const report = await auditPeekAdoption(REPO_ROOT);

  if (json) {
    console.log(
      JSON.stringify({
        schemaVersion: 1,
        tool: "lint-tochange",
        ok: report.ok && (!failOnPending || report.registryPending.length === 0),
        pending: report.registryPending.length,
        implemented: report.registryImplemented.length,
        skipped: report.skipped.length,
        registry: PEEK_ADOPTION_REGISTRY,
        markers: {
          pending: report.markersPending,
          implemented: report.markersImplemented,
        },
        issues: {
          probeFailures: report.probeFailures,
          missingTochangeMarkers: report.missingTochangeMarkers,
          staleTochangeMarkers: report.staleTochangeMarkers,
          duplicateIds: report.duplicateIds,
          orphanMarkers: report.orphanMarkers,
        },
      })
    );
    return report.ok && (!failOnPending || report.registryPending.length === 0) ? 0 : 1;
  }

  console.log(formatTochangeReport(report));

  if (!report.ok) return 1;
  if (failOnPending && report.registryPending.length > 0) return 1;
  return 0;
}

const code = await main();
process.exit(code);
