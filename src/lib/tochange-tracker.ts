/**
 * tochange-tracker.ts — Registry and scanner for `.tochange` / `.implemented` markers.
 *
 * Marker format (line comment):
 *   // .tochange:<id> — optional note
 *   // .implemented:<id> — optional note
 *
 * Used to track Bun.peek adoption and other staged refactors without losing grep visibility.
 */

import { join } from "path";

export type TochangeTier = "required" | "tier1" | "tier2" | "skip";

export type TochangeMarkerKind = "tochange" | "implemented";

export interface TochangeRegistryEntry {
  id: string;
  file: string;
  tier: TochangeTier;
  summary: string;
}

export interface TochangeMarker {
  id: string;
  kind: TochangeMarkerKind;
  file: string;
  line: number;
  text: string;
}

export interface TochangeAuditReport {
  ok: boolean;
  pending: TochangeMarker[];
  implemented: TochangeMarker[];
  skipped: TochangeRegistryEntry[];
  orphanMarkers: TochangeMarker[];
  duplicateIds: string[];
  missingMarkers: TochangeRegistryEntry[];
}

const MARKER_RE = /\/\/\s*\.(tochange|implemented):([a-z0-9-]+)/;

/** Canonical Bun.peek adoption backlog — ids must match source markers where tier !== "skip". */
export const PEEK_ADOPTION_REGISTRY: TochangeRegistryEntry[] = [
  {
    id: "peek-wrapper",
    file: "src/lib/bun-utils.ts",
    tier: "required",
    summary: "Export peekPromise / peekPromiseStatus wrappers over Bun.peek",
  },
  {
    id: "peek-tests",
    file: "test/tochange-tracker.unit.test.ts",
    tier: "required",
    summary: "Unit tests for peek wrappers and marker audit",
  },
  {
    id: "tochange-lint",
    file: "scripts/lint-tochange.ts",
    tier: "required",
    summary: "lint:tochange script greps markers and validates registry",
  },
  {
    id: "tool-runner-inflight",
    file: "src/lib/tool-runner.ts",
    tier: "tier1",
    summary: "In-flight Map<string, Promise<ToolInvocation>> dedup with peek fast path",
  },
  {
    id: "governor-cache-dedup",
    file: "src/lib/governor-cache.ts",
    tier: "tier1",
    summary: "Dedup concurrent cachedExec/cachedDoctor calls via peek",
  },
  {
    id: "proc-cache-async",
    file: "src/lib/proc-cache.ts",
    tier: "tier2",
    summary: "Optional async promise cache instead of spawnSync + sync string TTL",
  },
  {
    id: "memory-budget-peek",
    file: "src/lib/memory-budget.ts",
    tier: "tier2",
    summary: "Consumer updates if proc-cache moves to promise + peek pattern",
  },
  {
    id: "promise-all-fanout",
    file: "(aggregate)",
    tier: "skip",
    summary: "~30 files / ~45 Promise.all sites — parallel I/O; peek N/A",
  },
  {
    id: "effect-all-concurrency",
    file: "(aggregate)",
    tier: "skip",
    summary: "~7 Effect.all sites — Effect scheduling; peek N/A",
  },
  {
    id: "sync-sqlite-cache",
    file: "src/lib/governor-sessions.ts",
    tier: "skip",
    summary: "SQLite getCached returns resolved output; peek N/A unless promise cache added",
  },
];

const REGISTRY_IDS = new Set(PEEK_ADOPTION_REGISTRY.map((e) => e.id));

const SCAN_GLOBS = ["src/**/*.ts", "scripts/**/*.ts", "test/**/*.ts"];

/** Scan tracked trees for `.tochange:` and `.implemented:` markers. */
export async function scanTochangeMarkers(repoRoot: string): Promise<TochangeMarker[]> {
  const markers: TochangeMarker[] = [];

  for (const pattern of SCAN_GLOBS) {
    const glob = new Bun.Glob(pattern);
    for await (const rel of glob.scan({ cwd: repoRoot, onlyFiles: true })) {
      const path = join(repoRoot, rel);
      const text = await Bun.file(path).text();
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(MARKER_RE);
        if (!match) continue;
        markers.push({
          id: match[2],
          kind: match[1] as TochangeMarkerKind,
          file: rel,
          line: i + 1,
          text: lines[i].trim(),
        });
      }
    }
  }

  return markers.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/** Validate markers against PEEK_ADOPTION_REGISTRY and produce a tracking report. */
export function auditTochangeMarkers(
  markers: TochangeMarker[],
  registry: TochangeRegistryEntry[] = PEEK_ADOPTION_REGISTRY
): TochangeAuditReport {
  const pending = markers.filter((m) => m.kind === "tochange");
  const implemented = markers.filter((m) => m.kind === "implemented");

  const byId = new Map<string, TochangeMarker[]>();
  for (const m of markers) {
    const list = byId.get(m.id) ?? [];
    list.push(m);
    byId.set(m.id, list);
  }

  const duplicateIds = [...byId.entries()].filter(([, list]) => list.length > 1).map(([id]) => id);
  const orphanMarkers = markers.filter((m) => !REGISTRY_IDS.has(m.id));

  const markedIds = new Set(markers.map((m) => m.id));
  const missingMarkers = registry.filter((e) => e.tier !== "skip" && !markedIds.has(e.id));

  const skipped = registry.filter((e) => e.tier === "skip");

  const ok = orphanMarkers.length === 0 && duplicateIds.length === 0 && missingMarkers.length === 0;

  return {
    ok,
    pending,
    implemented,
    skipped,
    orphanMarkers,
    duplicateIds,
    missingMarkers,
  };
}

export async function auditPeekAdoption(repoRoot: string): Promise<TochangeAuditReport> {
  const markers = await scanTochangeMarkers(repoRoot);
  return auditTochangeMarkers(markers);
}

/** Human-readable report for lint:tochange and doctor probes. */
export function formatTochangeReport(report: TochangeAuditReport): string {
  const lines: string[] = [
    `tochange: ${report.pending.length} pending, ${report.implemented.length} implemented, ${report.skipped.length} skip (registry)`,
  ];

  if (report.implemented.length > 0) {
    lines.push("", "implemented:");
    for (const m of report.implemented) {
      lines.push(`  ✓ ${m.id}  ${m.file}:${m.line}`);
    }
  }

  if (report.pending.length > 0) {
    lines.push("", "pending (.tochange):");
    for (const m of report.pending) {
      lines.push(`  ○ ${m.id}  ${m.file}:${m.line}`);
    }
  }

  if (report.skipped.length > 0) {
    lines.push("", "skip (documented, no marker required):");
    for (const e of report.skipped) {
      lines.push(`  — ${e.id}  ${e.file}  ${e.summary}`);
    }
  }

  if (report.missingMarkers.length > 0) {
    lines.push("", "missing markers:");
    for (const e of report.missingMarkers) {
      lines.push(`  ✗ ${e.id}  expected in ${e.file}`);
    }
  }

  if (report.duplicateIds.length > 0) {
    lines.push("", "duplicate ids:", ...report.duplicateIds.map((id) => `  ✗ ${id}`));
  }

  if (report.orphanMarkers.length > 0) {
    lines.push("", "orphan markers (not in registry):");
    for (const m of report.orphanMarkers) {
      lines.push(`  ✗ ${m.id}  ${m.file}:${m.line}`);
    }
  }

  return lines.join("\n");
}
