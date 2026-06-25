/**
 * verify-bun-features runner — grouped Bun-native ritual checks for check:fast.
 */

import {
  ALL_AUDIT_ENDPOINTS,
  AUDIT_CLI_ENDPOINTS,
  AUDIT_HTTP_CURATED,
  DASHBOARD_HTTP_ENDPOINTS,
  AUDIT_ENDPOINTS_SCHEMA_VERSION,
  cliEndpointsWithDryRun,
  endpointCatalogSummary,
  type AuditEndpointMeta,
} from "./audit-endpoints-metadata.ts";
import { BUN_COLOR_STRING_FORMATS, verifyColorFormat } from "./bun-color-formats.ts";
import {
  archiveSupported,
  createSyncSnapshotArchive,
  extractSyncSnapshotArchive,
} from "./archive-persistence.ts";
import { bunImageSupported } from "./bun-image.ts";
import {
  auditCliAlignment,
  auditCliCaseAlignment,
  checkBunVersionPin,
  readableStreamToText,
} from "./bun-utils.ts";
import { runAllCliContractProbes } from "./bun-cli-contract-probes.ts";
import type { ToolchainManifest } from "./version.ts";
import { captureMimallocStats, parseMimallocStats } from "./memory/governor.ts";
import { runWebGlobalsContractProbes } from "./bun-web-globals-contract.ts";
import { elapsedMs, nowNs } from "./timing.ts";
import { ensureDir } from "./utils.ts";
import type { ConfigStatusReport } from "./config-status.ts";
import { tmpdir } from "os";
import { join } from "path";
import { gateSpawnEnv, probeBunExecutable, scrubEphemeralBunNodeDirs } from "./root-hygiene.ts";

function gateBunSpawn(args: string[], options: { cwd?: string } = {}) {
  scrubEphemeralBunNodeDirs();
  return Bun.spawn({
    cmd: [probeBunExecutable(), ...args],
    env: gateSpawnEnv(Bun.env),
    stdout: "pipe",
    stderr: "pipe",
    ...options,
  });
}

function elapsedMsRoundedLocal(startNs: number): number {
  return Math.round(elapsedMs(startNs));
}

export type VerifyCheckGroup = "runtime" | "audit" | "canvas" | "templates" | "color" | "profile";

export interface VerifyCheck {
  id: string;
  group: VerifyCheckGroup;
  ok: boolean;
  advisory?: boolean;
  ms: number;
  detail: string;
  endpointId?: string;
}

export interface VerifyEndpointProbe {
  endpointId: string;
  path: string;
  ok: boolean;
  ms: number;
  detail: string;
  mode: "dry-run" | "full";
}

export interface VerifyReportMetadata {
  schemaVersion: number;
  generatedAt: string;
  projectRoot: string;
  bunVersion: string;
  endpointCatalog: ReturnType<typeof endpointCatalogSummary>;
}

export interface VerifyReportSummary {
  total: number;
  passed: number;
  failed: number;
  advisory: number;
  configAligned: boolean | null;
  durationMs: number;
  bunVersion: string;
}

export interface VerifyReport {
  checks: VerifyCheck[];
  configReport: ConfigStatusReport | null;
  summary: VerifyReportSummary;
  metadata: VerifyReportMetadata;
  endpoints: {
    catalog: {
      cli: readonly AuditEndpointMeta[];
      http: {
        curated: readonly AuditEndpointMeta[];
        dashboard: readonly AuditEndpointMeta[];
      };
      all: readonly AuditEndpointMeta[];
    };
    probes: VerifyEndpointProbe[];
  };
}

export interface VerifyRunOptions {
  strict?: boolean;
  profile?: boolean;
  projectRoot?: string;
}

const checks: VerifyCheck[] = [];
const endpointProbes: VerifyEndpointProbe[] = [];
let configReport: ConfigStatusReport | null = null;
let reportProjectRoot = ".";

function record(
  id: string,
  group: VerifyCheckGroup,
  ok: boolean,
  detail: string,
  ms: number,
  advisory = false,
  endpointId?: string
): void {
  checks.push({ id, group, ok, detail, ms, advisory: advisory || undefined, endpointId });
}

function recordProbe(
  endpoint: AuditEndpointMeta,
  ok: boolean,
  detail: string,
  ms: number,
  mode: "dry-run" | "full"
): void {
  endpointProbes.push({
    endpointId: endpoint.id,
    path: endpoint.path,
    ok,
    detail,
    ms,
    mode,
  });
}

async function runScriptDryRun(script: string): Promise<{ ok: boolean; detail: string }> {
  const proc = gateBunSpawn(["run", script, "--dry-run"]);
  const exit = await proc.exited;
  const out = await readableStreamToText(proc.stdout);
  const err = await readableStreamToText(proc.stderr);
  const firstLine = (out || err).split("\n")[0]?.trim() ?? "";
  if (exit !== 0) {
    return { ok: false, detail: `exit ${exit}: ${firstLine}` };
  }
  return { ok: true, detail: firstLine };
}

async function checkWebGlobalsContract(): Promise<void> {
  const start = nowNs();
  const probes = runWebGlobalsContractProbes();
  const failed = probes.filter((p) => !p.ok);
  const ms = elapsedMsRoundedLocal(start);
  record(
    "web.globals",
    "runtime",
    failed.length === 0,
    failed.length === 0
      ? `${probes.length} probes ok`
      : failed.map((p) => `${p.id}: ${p.detail}`).join("; "),
    ms
  );
}

async function checkCliAlignment(): Promise<void> {
  const start = nowNs();
  const report = auditCliAlignment();
  const ms = elapsedMsRoundedLocal(start);
  record(
    "cli.alignment",
    "runtime",
    report.aligned,
    report.aligned
      ? `${report.percent}% (${report.covered}/${report.total} @ ${report.commit.slice(0, 12)})`
      : `gaps: ${report.uncovered.slice(0, 3).join(", ")}${report.uncovered.length > 3 ? "…" : ""}`,
    ms
  );
}

async function checkCliCaseAlignment(): Promise<void> {
  const start = nowNs();
  const report = auditCliCaseAlignment();
  const ms = elapsedMsRoundedLocal(start);
  record(
    "cli.case-alignment",
    "runtime",
    report.aligned,
    `${report.cataloguedPercent}% catalogued (${report.totalCases} cases) · depth ${report.depthWeightedPercent}% · ported ${report.portedPercent}%`,
    ms
  );
}

async function checkCliContractProbes(): Promise<void> {
  const start = nowNs();
  const probes = await runAllCliContractProbes();
  const failed = probes.filter((p) => !p.ok);
  const ms = elapsedMsRoundedLocal(start);
  record(
    "cli.contract",
    "runtime",
    failed.length === 0,
    failed.length === 0
      ? `${probes.length} probes ok`
      : failed.map((p) => `${p.id}: ${p.detail}`).join("; "),
    ms
  );
}

async function checkSymbolDispose(): Promise<void> {
  const start = nowNs();
  const ok = typeof Symbol.dispose === "symbol";
  const ms = elapsedMsRoundedLocal(start);
  record("symbol.dispose", "runtime", ok, ok ? "symbol" : String(Symbol.dispose), ms);
}

async function checkUsingStatement(): Promise<void> {
  const start = nowNs();
  try {
    class R {
      disposed = false;
      [Symbol.dispose](): void {
        this.disposed = true;
      }
    }
    {
      using _r = new R();
    }
    const ms = elapsedMsRoundedLocal(start);
    record("using", "runtime", true, "using block accepted and disposed", ms);
  } catch (error) {
    const ms = elapsedMsRoundedLocal(start);
    record("using", "runtime", false, error instanceof Error ? error.message : String(error), ms);
  }
}

async function checkBunGlob(): Promise<void> {
  const start = nowNs();
  try {
    const glob = new Bun.Glob("package.json");
    const hits = [...glob.scanSync(".")];
    const ms = elapsedMsRoundedLocal(start);
    record("bun.glob", "runtime", hits.length > 0, `${hits.length} package.json match(es)`, ms);
  } catch (error) {
    const ms = elapsedMsRoundedLocal(start);
    record(
      "bun.glob",
      "runtime",
      false,
      error instanceof Error ? error.message : String(error),
      ms
    );
  }
}

async function checkBunFileRoundTrip(): Promise<void> {
  const tmp = join(tmpdir(), `.verify-bun-features-${Date.now()}.tmp`);
  const start = nowNs();
  try {
    const text = "kimi-toolchain verify-bun-features";
    await Bun.write(tmp, text);
    const read = await Bun.file(tmp).text();
    const ms = elapsedMsRoundedLocal(start);
    record(
      "bun.file-write",
      "runtime",
      read === text,
      read === text ? "round-trip ok" : "round-trip mismatch",
      ms
    );
  } catch (error) {
    const ms = elapsedMsRoundedLocal(start);
    record(
      "bun.file-write",
      "runtime",
      false,
      error instanceof Error ? error.message : String(error),
      ms
    );
  } finally {
    try {
      await Bun.file(tmp).delete();
    } catch {
      // ignore cleanup errors
    }
  }
}

async function checkBunVersionPinMatch(): Promise<void> {
  const start = nowNs();
  try {
    const result = await checkBunVersionPin(Bun.version, reportProjectRoot);
    const ms = elapsedMsRoundedLocal(start);
    if (result.pinned) {
      record(
        "bun.version-pin",
        "runtime",
        result.ok,
        result.ok
          ? `Bun ${result.actual} satisfies pinned ${result.pinned}`
          : (result.reason ?? `Bun ${result.actual} does not satisfy pinned ${result.pinned}`),
        ms
      );
    } else {
      record("bun.version-pin", "runtime", true, "no .bun-version pin found", ms);
    }
  } catch (error) {
    const ms = elapsedMsRoundedLocal(start);
    record(
      "bun.version-pin",
      "runtime",
      false,
      error instanceof Error ? error.message : String(error),
      ms
    );
  }
}

async function checkBunSecrets(): Promise<void> {
  const start = nowNs();
  try {
    const secrets = Bun.secrets;
    const methods: string[] = [];
    if (typeof secrets === "object" && secrets !== null) {
      if (typeof secrets.get === "function") methods.push("get");
      if (typeof secrets.set === "function") methods.push("set");
      if (typeof secrets.delete === "function") methods.push("delete");
    }
    const ok = methods.length === 3;
    const ms = elapsedMsRoundedLocal(start);
    record(
      "bun.secrets",
      "runtime",
      ok,
      ok ? "get/set/delete available" : `API incomplete (${methods.join(", ") || "none"})`,
      ms
    );
  } catch (error) {
    const ms = elapsedMsRoundedLocal(start);
    record(
      "bun.secrets",
      "runtime",
      false,
      error instanceof Error ? error.message : String(error),
      ms
    );
  }
}

async function checkBunGc(): Promise<void> {
  const start = nowNs();
  const bun = Bun as typeof Bun & { gc?: (sync: boolean) => void };
  if (typeof bun.gc !== "function") {
    const ms = elapsedMsRoundedLocal(start);
    record("bun.gc", "runtime", true, "Bun.gc unavailable on this build", ms, true);
    return;
  }
  try {
    bun.gc(false);
    const ms = elapsedMsRoundedLocal(start);
    record("bun.gc", "runtime", true, "Bun.gc(false) accepted", ms);
  } catch (error) {
    const ms = elapsedMsRoundedLocal(start);
    record("bun.gc", "runtime", false, error instanceof Error ? error.message : String(error), ms);
  }
}

async function checkBunArchiveRoundTrip(): Promise<void> {
  const start = nowNs();
  if (!archiveSupported()) {
    const ms = elapsedMsRoundedLocal(start);
    record("bun.archive", "runtime", true, "Bun.Archive unavailable on this build", ms, true);
    return;
  }

  const tmp = join(tmpdir(), `kimi-archive-${Date.now()}`);
  try {
    const manifest: ToolchainManifest = {
      toolchainVersion: "0.0.0-verify",
      desktopVersion: null,
      gitHead: null,
      lastSyncedAt: new Date().toISOString(),
      files: [],
      fileHashes: { "lib/utils.ts": "abc123" },
    };
    const bytes = await createSyncSnapshotArchive(manifest, { compress: "gzip", level: 1 });
    const extracted = await extractSyncSnapshotArchive(bytes, tmp);
    const ok =
      extracted.manifest.toolchainVersion === manifest.toolchainVersion &&
      extracted.fileHashes["lib/utils.ts"] === "abc123";
    const ms = elapsedMsRoundedLocal(start);
    record(
      "bun.archive",
      "runtime",
      ok,
      ok ? `gzip round-trip ok (${bytes.length} bytes)` : "extracted manifest mismatch",
      ms
    );
  } catch (error) {
    const ms = elapsedMsRoundedLocal(start);
    record(
      "bun.archive",
      "runtime",
      false,
      error instanceof Error ? error.message : String(error),
      ms
    );
  } finally {
    try {
      await Bun.$`rm -rf ${tmp}`.quiet().nothrow();
    } catch {
      // ignore cleanup failures
    }
  }
}

/** Probe Bun.udpSocket bind/close (DNS hooks, StatsD, syndication transports). */
export async function verifyUdpSocket(): Promise<boolean> {
  try {
    const bun = Bun as typeof Bun & {
      udpSocket?: (opts: { port: number }) => Promise<{ close(): Promise<void> }>;
    };
    if (typeof bun.udpSocket !== "function") return false;
    const socket = await bun.udpSocket({ port: 0 });
    await socket.close();
    return true;
  } catch {
    return false;
  }
}

async function checkBunUdpSocket(): Promise<void> {
  const start = nowNs();
  const bun = Bun as typeof Bun & { udpSocket?: unknown };
  if (typeof bun.udpSocket !== "function") {
    const ms = elapsedMsRoundedLocal(start);
    record("bun.udp", "runtime", true, "Bun.udpSocket unavailable on this build", ms, true);
    return;
  }
  const ok = await verifyUdpSocket();
  const ms = elapsedMsRoundedLocal(start);
  record("bun.udp", "runtime", ok, ok ? "udpSocket bind/close ok" : "udpSocket probe failed", ms);
}

async function checkBunImageApi(): Promise<void> {
  const start = nowNs();
  const ok = bunImageSupported();
  const ms = elapsedMsRoundedLocal(start);
  record(
    "bun.image",
    "runtime",
    ok,
    ok ? "Bun.Image available" : "Bun.Image unavailable on this build",
    ms,
    !ok
  );
}

async function checkBunZstdRoundTrip(): Promise<void> {
  const start = nowNs();
  const sample = "kimi-toolchain verify-bun-features";
  try {
    const input = new TextEncoder().encode(sample);
    const compressed = await Bun.zstdCompress(input);
    const decompressed = await Bun.zstdDecompress(compressed);
    const text = new TextDecoder().decode(decompressed);
    const ok = text === sample;
    const ms = elapsedMsRoundedLocal(start);
    record(
      "bun.zstd",
      "runtime",
      ok,
      ok ? "compress/decompress round-trip ok" : "round-trip mismatch",
      ms
    );
  } catch (error) {
    const ms = elapsedMsRoundedLocal(start);
    record(
      "bun.zstd",
      "runtime",
      false,
      error instanceof Error ? error.message : String(error),
      ms
    );
  }
}

async function checkMimallocStats(): Promise<void> {
  const tmp = join(tmpdir(), `.verify-mimalloc-${Date.now()}.ts`);
  const start = nowNs();
  try {
    await Bun.write(tmp, "Bun.stdout.write('ok\\n');");
    const stats = await captureMimallocStats(tmp, { timeout: 15_000 });
    const ms = elapsedMsRoundedLocal(start);
    const hasStats = stats.combined.includes("heap stats:");
    if (hasStats) {
      const parsed = parseMimallocStats(stats.combined);
      record(
        "mimalloc.stats",
        "runtime",
        stats.exitCode === 0 && parsed !== undefined,
        parsed ? "heap stats captured and parsed" : "heap stats block present but unparsed",
        ms
      );
      return;
    }
    record(
      "mimalloc.stats",
      "runtime",
      stats.exitCode === 0,
      "script ok; mimalloc stats unavailable on this build",
      ms,
      true
    );
  } catch (error) {
    const ms = elapsedMsRoundedLocal(start);
    record(
      "mimalloc.stats",
      "runtime",
      false,
      error instanceof Error ? error.message : String(error),
      ms
    );
  } finally {
    try {
      await Bun.file(tmp).delete();
    } catch {
      // ignore cleanup errors
    }
  }
}

async function checkAuditScriptsDryRun(): Promise<void> {
  const seen = new Set<string>();
  const endpoints = cliEndpointsWithDryRun().filter((ep) => {
    if (seen.has(ep.path)) return false;
    seen.add(ep.path);
    return ep.path !== "audit:dry-run";
  });

  for (const endpoint of endpoints) {
    const start = nowNs();
    const { ok, detail } = await runScriptDryRun(endpoint.path);
    const ms = elapsedMsRoundedLocal(start);
    const checkId = endpoint.verifyCheckId ?? `audit.${endpoint.path}`;
    record(checkId, "audit", ok, detail, ms, false, endpoint.id);
    recordProbe(endpoint, ok, detail, ms, "dry-run");
  }
}

async function checkAuditDryRunBundle(): Promise<void> {
  const endpoint = AUDIT_CLI_ENDPOINTS.find((e) => e.path === "audit:dry-run");
  if (!endpoint) return;
  const start = nowNs();
  const proc = gateBunSpawn(["run", "audit:dry-run"]);
  const exit = await proc.exited;
  const out = await readableStreamToText(proc.stdout);
  const err = await readableStreamToText(proc.stderr);
  const ms = elapsedMsRoundedLocal(start);
  const combined = `${out}\n${err}`;
  const ok = exit === 0 && combined.includes("audit:secrets");
  const detail =
    exit === 0 ? "audit:dry-run bundle OK" : `exit ${exit}: ${combined.split("\n")[0]?.trim()}`;
  record("audit.bundle.dry-run", "audit", ok, detail, ms, false, endpoint.id);
  recordProbe(endpoint, ok, detail, ms, "dry-run");
}

async function checkAuditConfigGates(strict: boolean): Promise<void> {
  const endpoint =
    AUDIT_CLI_ENDPOINTS.find((e) => e.id === "config-status") ??
    AUDIT_CLI_ENDPOINTS.find((e) => e.path === "audit:config");
  const start = nowNs();

  if (strict) {
    const proc = gateBunSpawn(["run", "audit:config"]);
    const exit = await proc.exited;
    const out = await readableStreamToText(proc.stdout);
    const err = await readableStreamToText(proc.stderr);
    const ms = elapsedMsRoundedLocal(start);
    const summary = (out || err).split("\n").slice(0, 2).join("; ").trim();
    const ok = exit === 0;
    if (ok) {
      configReport = { aligned: true } as ConfigStatusReport;
      record("audit.config.gates", "audit", true, `aligned — ${summary}`, ms, false, endpoint?.id);
    } else {
      record(
        "audit.config.gates",
        "audit",
        false,
        `drift — exit ${exit}: ${summary.slice(0, 180)}`,
        ms,
        false,
        endpoint?.id
      );
    }
    if (endpoint) recordProbe(endpoint, ok, summary.slice(0, 180), ms, "full");
    return;
  }

  const proc = gateBunSpawn(["run", "scripts/config-status.ts", "--json"]);
  await proc.exited;
  const out = await readableStreamToText(proc.stdout);
  const ms = elapsedMsRoundedLocal(start);
  try {
    const report = JSON.parse(out) as ConfigStatusReport;
    configReport = report;
    const failed = report.gates.filter((g) => g.status === "fail").map((g) => g.id);
    const summary = report.gates.map((g) => `${g.id}:${g.status}`).join(", ");
    if (report.aligned) {
      record("audit.config.gates", "audit", true, `aligned — ${summary}`, ms, false, endpoint?.id);
      if (endpoint) recordProbe(endpoint, true, summary, ms, "full");
    } else {
      const detail = `drift (${failed.join(", ")}) — ${summary} · fix: ${report.fixPlan.join("; ")}`;
      record("audit.config.gates", "audit", true, detail, ms, true, endpoint?.id);
      if (endpoint) recordProbe(endpoint, false, detail, ms, "full");
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    record("audit.config.gates", "audit", false, `parse failed: ${msg}`, ms, false, endpoint?.id);
  }
}

async function checkCanvasCompanions(): Promise<void> {
  const endpoint = AUDIT_CLI_ENDPOINTS.find((e) => e.id === "canvas-generate");
  const start = nowNs();
  const proc = gateBunSpawn(["run", "canvas:generate", "--check"]);
  const exit = await proc.exited;
  const out = await readableStreamToText(proc.stdout);
  const err = await readableStreamToText(proc.stderr);
  const ms = elapsedMsRoundedLocal(start);
  const line =
    (out || err)
      .trim()
      .split("\n")
      .find((row) => row.length > 0) ?? "";
  if (exit === 0) {
    const detail = line || "canvas companions OK";
    record("canvas.companions", "canvas", true, detail, ms, false, endpoint?.id);
    if (endpoint) recordProbe(endpoint, true, detail, ms, "full");
    return;
  }
  const detail = line
    ? `${line} · fix: bun run canvas:generate`
    : "stale — fix: bun run canvas:generate";
  record("canvas.companions", "canvas", false, detail, ms, false, endpoint?.id);
  if (endpoint) recordProbe(endpoint, false, detail, ms, "full");
}

async function runTemplateGate(
  script: string,
  checkId: string,
  endpointId: string,
  fixHint: string
): Promise<void> {
  const endpoint = AUDIT_CLI_ENDPOINTS.find((e) => e.id === endpointId);
  const start = nowNs();
  const proc = gateBunSpawn(["run", script]);
  const exit = await proc.exited;
  const out = await readableStreamToText(proc.stdout);
  const err = await readableStreamToText(proc.stderr);
  const ms = elapsedMsRoundedLocal(start);
  const line =
    (out || err)
      .trim()
      .split("\n")
      .find((row) => row.length > 0 && !row.startsWith("$")) ?? "";
  const ok = exit === 0;
  const detail = ok
    ? line.replace(/^✅\s*/, "")
    : line
      ? `${line.replace(/^❌\s*/, "")} · fix: ${fixHint}`
      : `failed · fix: ${fixHint}`;
  record(checkId, "templates", ok, detail, ms, false, endpoint?.id);
  if (endpoint) recordProbe(endpoint, ok, detail, ms, "full");
}

async function checkTemplateGates(): Promise<void> {
  await Promise.all([
    runTemplateGate(
      "check:template-policy",
      "templates.policy",
      "check-template-policy",
      "bun run check:template-policy"
    ),
    runTemplateGate(
      "check:templates",
      "templates.registry",
      "check-templates",
      "bun run check:templates"
    ),
  ]);
}

async function checkBunColorStringFormats(): Promise<void> {
  for (const format of BUN_COLOR_STRING_FORMATS) {
    const start = nowNs();
    const probe = verifyColorFormat("#ff0000", format);
    const ms = elapsedMsRoundedLocal(start);
    record(`bun.color.${format}`, "color", probe.ok, probe.detail, ms);
  }
  const start = nowNs();
  try {
    Bun.color("#ff0000", "HSL" as "hsl");
    const ms = elapsedMsRoundedLocal(start);
    record("bun.color.HSL-rejected", "color", false, "HSL should throw", ms);
  } catch {
    const ms = elapsedMsRoundedLocal(start);
    record("bun.color.HSL-rejected", "color", true, "HSL alias rejected (use hsl)", ms);
  }
}

async function checkCpuProfCapture(): Promise<void> {
  const start = nowNs();
  const scriptPath = join(reportProjectRoot, "scripts", "verify-bun-features.ts");
  const profDir = join(reportProjectRoot, ".kimi-artifacts", "profiles");
  ensureDir(profDir);
  await Bun.write(join(profDir, ".gitkeep"), "");
  const proc = gateBunSpawn(
    ["--cpu-prof", "--cpu-prof-interval=500", "--cpu-prof-dir", profDir, "run", scriptPath],
    { cwd: reportProjectRoot }
  );
  const exit = await proc.exited;
  const err = await readableStreamToText(proc.stderr);
  const ms = elapsedMsRoundedLocal(start);
  if (exit !== 0) {
    record("cpu-prof.capture", "profile", false, `exit ${exit}: ${err.split("\n")[0]?.trim()}`, ms);
    return;
  }
  const glob = new Bun.Glob("*.cpuprofile");
  const files = [...glob.scanSync({ cwd: profDir, onlyFiles: true })].sort();
  const latest = files.at(-1);
  if (latest) {
    const archiveDir = join(tmpdir(), `kimi-cpu-prof-${Date.now()}`);
    ensureDir(archiveDir);
    const oldPath = join(profDir, latest);
    const newPath = join(archiveDir, latest);
    await Bun.write(newPath, await Bun.file(oldPath).arrayBuffer());
    try {
      await Bun.file(oldPath).delete();
    } catch {
      // ignore cleanup errors
    }
  }
  record(
    "cpu-prof.capture",
    "profile",
    !!latest,
    latest ? `captured ${latest}` : "no .cpuprofile found",
    ms
  );
}

function buildSummary(durationMs: number): VerifyReportSummary {
  const failed = checks.filter((c) => !c.ok).length;
  const advisory = checks.filter((c) => c.advisory && c.ok).length;
  return {
    total: checks.length,
    passed: checks.filter((c) => c.ok).length,
    failed,
    advisory,
    configAligned: configReport?.aligned ?? null,
    durationMs,
    bunVersion: Bun.version,
  };
}

export function countVerifyFailures(report: VerifyReport, strict = false): number {
  const blocking = report.checks.filter((c) => !c.ok);
  if (strict) return blocking.length;
  return blocking.filter((c) => !c.advisory).length;
}

export const VERIFY_GROUP_ORDER: VerifyCheckGroup[] = [
  "runtime",
  "audit",
  "canvas",
  "templates",
  "color",
  "profile",
];

export const VERIFY_GROUP_LABELS: Record<VerifyCheckGroup, string> = {
  runtime: "Runtime (Bun APIs)",
  audit: "Audit scripts",
  canvas: "Canvas companions",
  templates: "Bun-create templates",
  color: "Bun.color formats",
  profile: "CPU profile",
};

export async function runVerifyBunFeatures(options: VerifyRunOptions = {}): Promise<VerifyReport> {
  checks.length = 0;
  endpointProbes.length = 0;
  configReport = null;
  reportProjectRoot = options.projectRoot ?? process.cwd();
  scrubEphemeralBunNodeDirs();
  Object.assign(Bun.env, gateSpawnEnv(Bun.env));
  const started = nowNs();

  await checkWebGlobalsContract();
  await checkCliAlignment();
  await checkCliCaseAlignment();
  await checkCliContractProbes();
  await checkSymbolDispose();
  await checkUsingStatement();
  await checkBunGlob();
  await checkBunFileRoundTrip();
  await checkBunVersionPinMatch();
  await checkBunSecrets();
  await checkBunGc();
  await checkBunArchiveRoundTrip();
  await checkBunZstdRoundTrip();
  await checkBunUdpSocket();
  await checkBunImageApi();
  await checkMimallocStats();
  await checkAuditScriptsDryRun();
  await checkAuditDryRunBundle();
  await checkAuditConfigGates(options.strict ?? false);
  await checkCanvasCompanions();
  await checkTemplateGates();
  await checkBunColorStringFormats();

  if (options.profile) {
    await checkCpuProfCapture();
  }

  const durationMs = elapsedMsRoundedLocal(started);
  return {
    checks: [...checks],
    configReport,
    summary: buildSummary(durationMs),
    metadata: {
      schemaVersion: AUDIT_ENDPOINTS_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      projectRoot: reportProjectRoot,
      bunVersion: Bun.version,
      endpointCatalog: endpointCatalogSummary(),
    },
    endpoints: {
      catalog: {
        cli: AUDIT_CLI_ENDPOINTS,
        http: {
          curated: AUDIT_HTTP_CURATED,
          dashboard: DASHBOARD_HTTP_ENDPOINTS,
        },
        all: ALL_AUDIT_ENDPOINTS,
      },
      probes: [...endpointProbes],
    },
  };
}
