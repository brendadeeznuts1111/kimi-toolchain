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
import { readableStreamToText } from "./bun-utils.ts";
import type { ConfigStatusReport } from "./config-status.ts";
import { tmpdir } from "os";
import { join } from "path";

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
  const proc = Bun.spawn({
    cmd: ["bun", "run", script, "--dry-run"],
    stdout: "pipe",
    stderr: "pipe",
  });
  const exit = await proc.exited;
  const out = await readableStreamToText(proc.stdout);
  const err = await readableStreamToText(proc.stderr);
  const firstLine = (out || err).split("\n")[0]?.trim() ?? "";
  if (exit !== 0) {
    return { ok: false, detail: `exit ${exit}: ${firstLine}` };
  }
  return { ok: true, detail: firstLine };
}

async function checkSymbolDispose(): Promise<void> {
  const start = Bun.nanoseconds();
  const ok = typeof Symbol.dispose === "symbol";
  const ms = Math.round((Bun.nanoseconds() - start) / 1_000_000);
  record("symbol.dispose", "runtime", ok, ok ? "symbol" : String(Symbol.dispose), ms);
}

async function checkUsingStatement(): Promise<void> {
  const start = Bun.nanoseconds();
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
    const ms = Math.round((Bun.nanoseconds() - start) / 1_000_000);
    record("using", "runtime", true, "using block accepted and disposed", ms);
  } catch (error) {
    const ms = Math.round((Bun.nanoseconds() - start) / 1_000_000);
    record("using", "runtime", false, error instanceof Error ? error.message : String(error), ms);
  }
}

async function checkBunGlob(): Promise<void> {
  const start = Bun.nanoseconds();
  try {
    const glob = new Bun.Glob("package.json");
    const hits = [...glob.scanSync(".")];
    const ms = Math.round((Bun.nanoseconds() - start) / 1_000_000);
    record("bun.glob", "runtime", hits.length > 0, `${hits.length} package.json match(es)`, ms);
  } catch (error) {
    const ms = Math.round((Bun.nanoseconds() - start) / 1_000_000);
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
  const start = Bun.nanoseconds();
  try {
    const text = "kimi-toolchain verify-bun-features";
    await Bun.write(tmp, text);
    const read = await Bun.file(tmp).text();
    const ms = Math.round((Bun.nanoseconds() - start) / 1_000_000);
    record(
      "bun.file-write",
      "runtime",
      read === text,
      read === text ? "round-trip ok" : "round-trip mismatch",
      ms
    );
  } catch (error) {
    const ms = Math.round((Bun.nanoseconds() - start) / 1_000_000);
    record(
      "bun.file-write",
      "runtime",
      false,
      error instanceof Error ? error.message : String(error),
      ms
    );
  } finally {
    await Bun.file(tmp)
      .delete()
      .catch(() => {});
  }
}

async function checkAuditScriptsDryRun(): Promise<void> {
  const seen = new Set<string>();
  const endpoints = cliEndpointsWithDryRun().filter((ep) => {
    if (seen.has(ep.path)) return false;
    seen.add(ep.path);
    return ep.path !== "audit:dry-run";
  });

  await Promise.all(
    endpoints.map(async (endpoint) => {
      const start = Bun.nanoseconds();
      const { ok, detail } = await runScriptDryRun(endpoint.path);
      const ms = Math.round((Bun.nanoseconds() - start) / 1_000_000);
      const checkId = endpoint.verifyCheckId ?? `audit.${endpoint.path}`;
      record(checkId, "audit", ok, detail, ms, false, endpoint.id);
      recordProbe(endpoint, ok, detail, ms, "dry-run");
    })
  );
}

async function checkAuditDryRunBundle(): Promise<void> {
  const endpoint = AUDIT_CLI_ENDPOINTS.find((e) => e.path === "audit:dry-run");
  if (!endpoint) return;
  const start = Bun.nanoseconds();
  const proc = Bun.spawn({
    cmd: ["bun", "run", "audit:dry-run"],
    stdout: "pipe",
    stderr: "pipe",
  });
  const exit = await proc.exited;
  const out = await readableStreamToText(proc.stdout);
  const err = await readableStreamToText(proc.stderr);
  const ms = Math.round((Bun.nanoseconds() - start) / 1_000_000);
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
  const start = Bun.nanoseconds();

  if (strict) {
    const proc = Bun.spawn({
      cmd: ["bun", "run", "audit:config"],
      stdout: "pipe",
      stderr: "pipe",
    });
    const exit = await proc.exited;
    const out = await readableStreamToText(proc.stdout);
    const err = await readableStreamToText(proc.stderr);
    const ms = Math.round((Bun.nanoseconds() - start) / 1_000_000);
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

  const proc = Bun.spawn({
    cmd: ["bun", "run", "scripts/config-status.ts", "--json"],
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;
  const out = await readableStreamToText(proc.stdout);
  const ms = Math.round((Bun.nanoseconds() - start) / 1_000_000);
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

async function checkParallelScripts(): Promise<void> {
  const start = Bun.nanoseconds();
  const proc = Bun.spawn({
    cmd: [
      "bun",
      "run",
      "--parallel",
      "bun run audit:secrets --dry-run",
      "bun run audit:config --dry-run",
      "bun run audit:images --dry-run",
      "bun run audit:network --dry-run",
    ],
    stdout: "pipe",
    stderr: "pipe",
  });
  const exit = await proc.exited;
  const out = await readableStreamToText(proc.stdout);
  const err = await readableStreamToText(proc.stderr);
  const ms = Math.round((Bun.nanoseconds() - start) / 1_000_000);
  const combined = `${out}\n${err}`;
  const expected = ["audit:secrets", "config:status", "audit:images", "audit:network"];
  const missing = expected.filter((marker) => !combined.includes(marker));
  if (exit !== 0) {
    record(
      "audit.parallel",
      "audit",
      false,
      `exit ${exit}: ${combined.split("\n")[0]?.trim()}`,
      ms
    );
  } else {
    record(
      "audit.parallel",
      "audit",
      missing.length === 0,
      missing.length === 0
        ? "dry-run parallel OK (secrets + config + images + network)"
        : `missing: ${missing.join(", ")}`,
      ms
    );
  }
}

async function checkCanvasCompanions(): Promise<void> {
  const endpoint = AUDIT_CLI_ENDPOINTS.find((e) => e.id === "canvas-generate");
  const start = Bun.nanoseconds();
  const proc = Bun.spawn({
    cmd: ["bun", "run", "canvas:generate", "--check"],
    stdout: "pipe",
    stderr: "pipe",
  });
  const exit = await proc.exited;
  const out = await readableStreamToText(proc.stdout);
  const err = await readableStreamToText(proc.stderr);
  const ms = Math.round((Bun.nanoseconds() - start) / 1_000_000);
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
  const start = Bun.nanoseconds();
  const proc = Bun.spawn({
    cmd: ["bun", "run", script],
    stdout: "pipe",
    stderr: "pipe",
  });
  const exit = await proc.exited;
  const out = await readableStreamToText(proc.stdout);
  const err = await readableStreamToText(proc.stderr);
  const ms = Math.round((Bun.nanoseconds() - start) / 1_000_000);
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
    const start = Bun.nanoseconds();
    const probe = verifyColorFormat("#ff0000", format);
    const ms = Math.round((Bun.nanoseconds() - start) / 1_000_000);
    record(`bun.color.${format}`, "color", probe.ok, probe.detail, ms);
  }
  const start = Bun.nanoseconds();
  try {
    Bun.color("#ff0000", "HSL" as "hsl");
    const ms = Math.round((Bun.nanoseconds() - start) / 1_000_000);
    record("bun.color.HSL-rejected", "color", false, "HSL should throw", ms);
  } catch {
    const ms = Math.round((Bun.nanoseconds() - start) / 1_000_000);
    record("bun.color.HSL-rejected", "color", true, "HSL alias rejected (use hsl)", ms);
  }
}

async function checkCpuProfCapture(): Promise<void> {
  const start = Bun.nanoseconds();
  const scriptPath = join(reportProjectRoot, "scripts", "verify-bun-features.ts");
  const proc = Bun.spawn({
    cmd: ["bun", "--cpu-prof", "--cpu-prof-interval=500", "run", scriptPath],
    stdout: "pipe",
    stderr: "pipe",
    cwd: reportProjectRoot,
  });
  const exit = await proc.exited;
  const err = await readableStreamToText(proc.stderr);
  const ms = Math.round((Bun.nanoseconds() - start) / 1_000_000);
  if (exit !== 0) {
    record("cpu-prof.capture", "profile", false, `exit ${exit}: ${err.split("\n")[0]?.trim()}`, ms);
    return;
  }
  const glob = new Bun.Glob("*.cpuprofile");
  const files = [...glob.scanSync(reportProjectRoot)].sort();
  const latest = files.at(-1);
  if (latest) {
    // Move the captured profile out of the repo root into a temp dir.
    const profDir = join(tmpdir(), `kimi-cpu-prof-${Date.now()}`);
    await Bun.write(join(profDir, ".gitkeep"), "");
    const oldPath = join(reportProjectRoot, latest);
    const newPath = join(profDir, latest);
    await Bun.write(newPath, await Bun.file(oldPath).arrayBuffer());
    await Bun.file(oldPath)
      .delete()
      .catch(() => {});
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
  const started = Bun.nanoseconds();

  await checkSymbolDispose();
  await checkUsingStatement();
  await checkBunGlob();
  await checkBunFileRoundTrip();
  await checkAuditScriptsDryRun();
  await checkAuditDryRunBundle();
  await checkParallelScripts();
  await checkAuditConfigGates(options.strict ?? false);
  await checkCanvasCompanions();
  await checkTemplateGates();
  await checkBunColorStringFormats();

  if (options.profile) {
    await checkCpuProfCapture();
  }

  const durationMs = Math.round((Bun.nanoseconds() - started) / 1_000_000);
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
