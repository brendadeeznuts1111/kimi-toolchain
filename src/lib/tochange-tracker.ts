/**
 * tochange-tracker.ts — Registry-first adoption tracker with optional `.tochange` markers.
 *
 * Registry `status` is authoritative for implemented/skip items (code probes verify).
 * Pending work must set `status: "pending"` and include `// .tochange:<id>` in `file`.
 */

import { join } from "path";

export type TochangeTier = "required" | "tier1" | "tier2" | "skip";
export type TochangeStatus = "implemented" | "pending" | "skip";

export type TochangeMarkerKind = "tochange" | "implemented";

export interface TochangeRegistryEntry {
  id: string;
  file: string;
  tier: TochangeTier;
  status: TochangeStatus;
  summary: string;
  /** Required substring in `file` when status is implemented (unless marker present). */
  probe?: string;
}

export interface TochangeMarker {
  id: string;
  kind: TochangeMarkerKind;
  file: string;
  line: number;
  text: string;
}

export interface DirectStreamReadHit {
  file: string;
  line: number;
}

export interface TochangeAuditReport {
  ok: boolean;
  registryPending: TochangeRegistryEntry[];
  registryImplemented: TochangeRegistryEntry[];
  skipped: TochangeRegistryEntry[];
  markersPending: TochangeMarker[];
  markersImplemented: TochangeMarker[];
  orphanMarkers: TochangeMarker[];
  duplicateIds: string[];
  probeFailures: TochangeRegistryEntry[];
  staleTochangeMarkers: TochangeMarker[];
  missingTochangeMarkers: TochangeRegistryEntry[];
  /** Direct Bun.readableStreamToText outside canonical owner (feature code only). */
  directStreamReads: DirectStreamReadHit[];
}

const MARKER_RE = /\/\/\s*\.(tochange|implemented):([a-z0-9-]+)/;

/** Canonical Bun.peek adoption registry — single source of truth. */
export const PEEK_ADOPTION_REGISTRY: TochangeRegistryEntry[] = [
  {
    id: "peek-direct",
    file: "src/lib/bun-utils.ts",
    tier: "required",
    status: "implemented",
    summary: "dedupInflight uses Bun.peek / peek.status directly",
    probe: "peek.status",
  },
  {
    id: "peek-tests",
    file: "test/tochange-tracker.unit.test.ts",
    tier: "required",
    status: "implemented",
    summary: "Unit tests for peek wrappers, dedup, and registry audit",
    probe: 'describe("tochange-tracker"',
  },
  {
    id: "tochange-lint",
    file: "scripts/lint-tochange.ts",
    tier: "required",
    status: "implemented",
    summary: "lint:tochange validates registry and optional markers",
    probe: 'tool: "lint-tochange"',
  },
  {
    id: "tool-runner-inflight",
    file: "src/lib/tool-runner.ts",
    tier: "tier1",
    status: "implemented",
    summary: "dedupInflight on invokeCommand",
    probe: "dedupInflight(inflightCommands",
  },
  {
    id: "governor-cache-dedup",
    file: "src/lib/governor-cache.ts",
    tier: "tier1",
    status: "implemented",
    summary: "dedupInflight on cachedExec / cachedDoctor",
    probe: "dedupInflight(inflightExec",
  },
  {
    id: "proc-cache-command",
    file: "src/lib/proc-cache.ts",
    tier: "tier1",
    status: "implemented",
    summary: "getCachedCommandOutput(Async) — generic TTL cache for ps/pgrep",
    probe: "export async function getCachedCommandOutputAsync",
  },
  {
    id: "proc-cache-async",
    file: "src/lib/proc-cache.ts",
    tier: "tier2",
    status: "implemented",
    summary: "getCachedPsAsync delegates to getCachedCommandOutputAsync",
    probe: "export async function getCachedPsAsync",
  },
  {
    id: "governor-spawn-proc-cache",
    file: "src/lib/governor-spawn.ts",
    tier: "tier1",
    status: "implemented",
    summary: "pgrep/ps tree helpers route through proc-cache not raw spawn",
    probe: "getCachedCommandOutputAsync",
  },
  {
    id: "memory-budget-peek",
    file: "src/lib/memory-budget.ts",
    tier: "tier2",
    status: "implemented",
    summary: "runSystemMemoryChecks warms ps caches via getCachedPsAsync",
    probe: "getCachedPsAsync",
  },
  {
    id: "memory-budget-pgrep",
    file: "src/lib/memory-budget.ts",
    tier: "tier2",
    status: "implemented",
    summary: "Docker/sync daemon probes route pgrep through proc-cache",
    probe: 'getCachedCommandOutput("pgrep"',
  },
  {
    id: "promise-all-fanout",
    file: "(aggregate)",
    tier: "skip",
    status: "skip",
    summary: "~30 files / ~45 Promise.all sites — parallel I/O; peek N/A",
  },
  {
    id: "effect-all-concurrency",
    file: "(aggregate)",
    tier: "skip",
    status: "skip",
    summary: "~7 Effect.all sites — Effect scheduling; peek N/A",
  },
  {
    id: "sync-sqlite-cache",
    file: "src/lib/governor-sessions.ts",
    tier: "skip",
    status: "skip",
    summary: "SQLite getCached returns resolved output; peek N/A unless promise cache added",
  },
];

/** Canonical stream-read adoption — feature code routes through bun-utils. */
export const STREAM_READ_REGISTRY: TochangeRegistryEntry[] = [
  {
    id: "stream-read-wrapper",
    file: "src/lib/bun-utils.ts",
    tier: "required",
    status: "implemented",
    summary: "readableStreamToText null-safe canonical wrapper",
    probe: "export async function readableStreamToText",
  },
  {
    id: "stream-read-tests",
    file: "(aggregate)",
    tier: "skip",
    status: "skip",
    summary: "test/** may use Bun.readableStreamToText for subprocess fixtures",
  },
  {
    id: "stream-read-run-tests",
    file: "src/lib/test-runtime.ts",
    tier: "tier2",
    status: "implemented",
    summary: "runBunTest quiet mode reads streams via Bun.readableStreamToText",
    probe: "readableStreamToText(proc.stdout)",
  },
  {
    id: "stream-read-pr-status",
    file: "scripts/pr-status.ts",
    tier: "tier2",
    status: "implemented",
    summary: "pr-status local CI probe routes through bun-utils",
    probe: "readableStreamToText(proc.stdout)",
  },
  {
    id: "scripts-cleanup-bun-io",
    file: "src/lib/cleanup-hygiene.ts",
    tier: "tier2",
    status: "implemented",
    summary: "cleanup-hygiene unifies path/root/artifacts cleanup via hygiene libs",
    probe: 'from "./root-hygiene.ts"',
  },
];

/** Spawn path boundaries — intentional owners; do not collapse. */
export const SPAWN_BOUNDARY_REGISTRY: TochangeRegistryEntry[] = [
  {
    id: "spawn-invoke-command",
    file: "src/lib/tool-runner.ts",
    tier: "required",
    status: "implemented",
    summary: "invokeCommand — bounded output, timeout, dedup (doctor/MCP/shell bridge)",
    probe: "export async function invokeCommand",
  },
  {
    id: "spawn-governed",
    file: "src/lib/governor-spawn.ts",
    tier: "required",
    status: "implemented",
    summary: "governedSpawn — resource limits, tree-kill, retry (governor cache/herdr)",
    probe: "export async function governedSpawn",
  },
  {
    id: "spawn-shell-bridge",
    file: "src/bin/unified-shell-bridge.ts",
    tier: "tier1",
    status: "implemented",
    summary: "MCP shell bridge maps invokeCommand → ShellResult contract",
    probe: 'invokeCommand(["sh", "-c", command]',
  },
  {
    id: "spawn-kimi-doctor-wrapper",
    file: "src/lib/kimi-doctor-wrapper.ts",
    tier: "tier1",
    status: "implemented",
    summary: "runOfficialKimiDoctor routes through invokeCommand not raw Bun.spawn",
    probe: 'invokeCommand(["kimi", "doctor"]',
  },
];

/** Effect boundary for subprocess invocation — invokeCommandEffect over raw invokeCommand. */
export const EFFECT_BOUNDARY_REGISTRY: TochangeRegistryEntry[] = [
  {
    id: "invoke-command-effect",
    file: "src/lib/effect/tool-runner-effect.ts",
    tier: "required",
    status: "implemented",
    summary: "invokeCommandEffect wraps invokeCommand with tagged errors",
    probe: "export function invokeCommandEffect",
  },
  {
    id: "doctor-plugins-effect",
    file: "src/lib/doctor-plugins.ts",
    tier: "tier1",
    status: "implemented",
    summary: "runDoctorPluginEffect routes through invokeCommandEffect",
    probe: "invokeCommandEffect([plugin.command",
  },
  {
    id: "doctor-mcp-effect",
    file: "src/lib/effect/doctor-mcp-runtime.ts",
    tier: "tier1",
    status: "implemented",
    summary: "MCP runDoctor routes through invokeCommandEffect",
    probe: 'invokeCommandEffect(["bun"',
  },
  {
    id: "external-tool-runner-effect",
    file: "src/lib/external-tool-runner.ts",
    tier: "tier1",
    status: "implemented",
    summary: "runExternalToolAdapterEffect routes through invokeCommandEffect",
    probe: "invokeCommandEffect(resolvedCommand",
  },
];

/** All adoption registries audited by lint:tochange. */
export const ADOPTION_REGISTRIES: TochangeRegistryEntry[] = [
  ...PEEK_ADOPTION_REGISTRY,
  ...STREAM_READ_REGISTRY,
  ...EFFECT_BOUNDARY_REGISTRY,
  ...SPAWN_BOUNDARY_REGISTRY,
];

const REGISTRY_IDS = new Set(ADOPTION_REGISTRIES.map((e) => e.id));
const SCAN_GLOBS = ["src/**/*.ts", "scripts/**/*.ts", "test/**/*.ts"];

const STREAM_READ_SCAN_GLOBS = ["src/lib/**/*.ts", "src/bin/**/*.ts", "src/install-hooks/**/*.ts"];
const STREAM_READ_ALLOWLIST = new Set([
  "src/lib/bun-utils.ts",
  "src/lib/bun-native-lint.ts",
  "src/lib/tochange-tracker.ts",
]);
const STREAM_READ_CALL_RE = /\bBun\.readableStreamToText\s*\(/;

/** Scan tracked trees for optional `.tochange` / `.implemented` markers. */
export async function scanTochangeMarkers(repoRoot: string): Promise<TochangeMarker[]> {
  const markers: TochangeMarker[] = [];

  for (const pattern of SCAN_GLOBS) {
    const glob = new Bun.Glob(pattern);
    for await (const rel of glob.scan({ cwd: repoRoot, onlyFiles: true })) {
      const text = await Bun.file(join(repoRoot, rel)).text();
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

async function readProbeFile(repoRoot: string, rel: string): Promise<string> {
  if (rel.startsWith("(")) return "";
  return Bun.file(join(repoRoot, rel)).text();
}

/** Find direct Bun.readableStreamToText in feature code (should be zero). */
export async function scanDirectStreamReads(repoRoot: string): Promise<DirectStreamReadHit[]> {
  const hits: DirectStreamReadHit[] = [];

  for (const pattern of STREAM_READ_SCAN_GLOBS) {
    const glob = new Bun.Glob(pattern);
    for await (const rel of glob.scan({ cwd: repoRoot, onlyFiles: true })) {
      if (STREAM_READ_ALLOWLIST.has(rel)) continue;
      const text = await Bun.file(join(repoRoot, rel)).text();
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!STREAM_READ_CALL_RE.test(line)) continue;
        if (/^\s*(\/\/|\*)/.test(line)) continue;
        hits.push({ file: rel, line: i + 1 });
      }
    }
  }

  return hits.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/** Validate registry status, probes, and optional markers. */
export async function auditTochangeRegistry(
  repoRoot: string,
  markers: TochangeMarker[],
  registry: TochangeRegistryEntry[] = ADOPTION_REGISTRIES,
  directStreamReads: DirectStreamReadHit[] = []
): Promise<TochangeAuditReport> {
  const markersPending = markers.filter((m) => m.kind === "tochange");
  const markersImplemented = markers.filter((m) => m.kind === "implemented");

  const byId = new Map<string, TochangeMarker[]>();
  for (const m of markers) {
    const list = byId.get(m.id) ?? [];
    list.push(m);
    byId.set(m.id, list);
  }

  const duplicateIds = [...byId.entries()].filter(([, list]) => list.length > 1).map(([id]) => id);
  const orphanMarkers = markers.filter((m) => !REGISTRY_IDS.has(m.id));

  const registryPending = registry.filter((e) => e.status === "pending");
  const registryImplemented = registry.filter((e) => e.status === "implemented");
  const skipped = registry.filter((e) => e.status === "skip");

  const markerPendingIds = new Set(markersPending.map((m) => m.id));
  const missingTochangeMarkers = registryPending.filter((e) => !markerPendingIds.has(e.id));

  const staleTochangeMarkers = markersPending.filter((m) => {
    const entry = registry.find((e) => e.id === m.id);
    return entry?.status === "implemented" || entry?.status === "skip";
  });

  const probeFailures: TochangeRegistryEntry[] = [];
  for (const entry of registryImplemented) {
    if (!entry.probe || entry.file.startsWith("(")) continue;
    const hasMarker = markers.some((m) => m.id === entry.id && m.kind === "implemented");
    if (hasMarker) continue;
    const text = await readProbeFile(repoRoot, entry.file);
    if (!text.includes(entry.probe)) probeFailures.push(entry);
  }

  const ok =
    orphanMarkers.length === 0 &&
    duplicateIds.length === 0 &&
    missingTochangeMarkers.length === 0 &&
    staleTochangeMarkers.length === 0 &&
    probeFailures.length === 0 &&
    directStreamReads.length === 0;

  return {
    ok,
    registryPending,
    registryImplemented,
    skipped,
    markersPending,
    markersImplemented,
    orphanMarkers,
    duplicateIds,
    probeFailures,
    staleTochangeMarkers,
    missingTochangeMarkers,
    directStreamReads,
  };
}

export async function auditPeekAdoption(repoRoot: string): Promise<TochangeAuditReport> {
  const markers = await scanTochangeMarkers(repoRoot);
  const directStreamReads = await scanDirectStreamReads(repoRoot);
  return auditTochangeRegistry(repoRoot, markers, ADOPTION_REGISTRIES, directStreamReads);
}

/** Human-readable report for lint:tochange. */
export function formatTochangeReport(report: TochangeAuditReport): string {
  const lines: string[] = [
    `tochange: ${report.registryPending.length} pending (registry), ${report.registryImplemented.length} implemented (registry), ${report.skipped.length} skip`,
  ];

  if (report.registryImplemented.length > 0) {
    lines.push("", "implemented (registry):");
    for (const e of report.registryImplemented) {
      lines.push(`  ✓ ${e.id}  ${e.file}`);
    }
  }

  if (report.registryPending.length > 0) {
    lines.push("", "pending (registry):");
    for (const e of report.registryPending) {
      lines.push(`  ○ ${e.id}  ${e.file}  ${e.summary}`);
    }
  }

  if (report.markersPending.length > 0) {
    lines.push("", "pending (.tochange markers):");
    for (const m of report.markersPending) {
      lines.push(`  ○ ${m.id}  ${m.file}:${m.line}`);
    }
  }

  if (report.skipped.length > 0) {
    lines.push("", "skip:");
    for (const e of report.skipped) {
      lines.push(`  — ${e.id}  ${e.file}`);
    }
  }

  if (report.probeFailures.length > 0) {
    lines.push("", "probe failures:");
    for (const e of report.probeFailures) {
      lines.push(`  ✗ ${e.id}  missing probe in ${e.file}`);
    }
  }

  if (report.missingTochangeMarkers.length > 0) {
    lines.push("", "missing .tochange markers:");
    for (const e of report.missingTochangeMarkers) {
      lines.push(`  ✗ ${e.id}  expected in ${e.file}`);
    }
  }

  if (report.staleTochangeMarkers.length > 0) {
    lines.push("", "stale .tochange markers (registry no longer pending):");
    for (const m of report.staleTochangeMarkers) {
      lines.push(`  ✗ ${m.id}  ${m.file}:${m.line}`);
    }
  }

  if (report.duplicateIds.length > 0) {
    lines.push("", "duplicate marker ids:", ...report.duplicateIds.map((id) => `  ✗ ${id}`));
  }

  if (report.orphanMarkers.length > 0) {
    lines.push("", "orphan markers:");
    for (const m of report.orphanMarkers) {
      lines.push(`  ✗ ${m.id}  ${m.file}:${m.line}`);
    }
  }

  if (report.directStreamReads.length > 0) {
    lines.push("", "direct Bun.readableStreamToText (use bun-utils.readableStreamToText):");
    for (const hit of report.directStreamReads) {
      lines.push(`  ✗ ${hit.file}:${hit.line}`);
    }
  }

  return lines.join("\n");
}
