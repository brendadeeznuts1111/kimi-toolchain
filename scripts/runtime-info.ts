#!/usr/bin/env bun
/** Enhanced replacement for `bun -e 'console.log({ version: Bun.version, ... })'`. */
import { join } from "path";
import { buildDeepRuntimeReport } from "../src/lib/runtime-introspection.ts";
import {
  bunRuntimeReport,
  formatEditorRuntimeSnapshot,
  formatFullBunRuntimeSnapshot,
  formatMemoryBytes,
  formatProcessMemoryUsage,
  inspectBunRuntime,
  processMemoryUsage,
} from "../src/lib/bun-utils.ts";
import { captureMimallocStats, parseMimallocStats } from "../src/lib/memory/governor.ts";
import { formatWorkspaceRuntimeSnapshot } from "../src/lib/workspace-runtime.ts";

function parseArg(name: string): string | undefined {
  const prefix = `${name}=`;
  const flagged = Bun.argv.find((a) => a.startsWith(prefix));
  if (flagged) return flagged.slice(prefix.length);
  const index = Bun.argv.indexOf(name);
  if (index >= 0 && index + 1 < Bun.argv.length) return Bun.argv[index + 1];
  return undefined;
}

const json = Bun.argv.includes("--json");
const withWorkspace = Bun.argv.includes("--workspace");
const withEditor = Bun.argv.includes("--editor");
const withCoverage = Bun.argv.includes("--coverage");
const probeMcp = Bun.argv.includes("--probe-mcp");
const deep = withWorkspace || withEditor || withCoverage || probeMcp;
const pretty = Bun.argv.includes("--pretty") || (!json && (Bun.argv.length <= 2 || deep));
const mimallocScript = parseArg("--mimalloc");

interface PackageMeta {
  name?: string;
  version?: string;
  engineRange?: string;
  packageManager?: string;
}

async function readPackageMeta(): Promise<PackageMeta> {
  const pkgPath = join(import.meta.dir, "..", "package.json");
  try {
    const pkg = (await Bun.file(pkgPath).json()) as {
      name?: string;
      version?: string;
      engines?: { bun?: string };
      packageManager?: string;
    };
    return {
      name: pkg.name,
      version: pkg.version,
      engineRange: pkg.engines?.bun,
      packageManager: pkg.packageManager,
    };
  } catch {
    return {};
  }
}

const meta = await readPackageMeta();
const engineRange = meta.engineRange ?? ">=1.4.0";
const report = bunRuntimeReport(engineRange);
const processMemory = processMemoryUsage();
const processMemoryFormatted = formatProcessMemoryUsage(processMemory);
const deepReport =
  deep || json
    ? await buildDeepRuntimeReport({
        probeMcp: probeMcp || json,
        probeUtilsDocs: withCoverage || json,
      })
    : undefined;

function processMemoryBreakdown(mem: typeof processMemory) {
  const rss = mem.rss || 1;
  return {
    heapUsedPercentOfRss: Math.round((mem.heapUsed / rss) * 1000) / 10,
    externalPercentOfRss: Math.round((mem.external / rss) * 1000) / 10,
    arrayBuffersPercentOfRss: Math.round((mem.arrayBuffers / rss) * 1000) / 10,
  };
}

const { heapStats } = await import("bun:jsc");
const jscHeap = heapStats();

const payload = {
  ...report,
  processMemory: {
    ...processMemory,
    formatted: processMemoryFormatted,
    breakdown: processMemoryBreakdown(processMemory),
  },
  jscHeap: {
    heapSize: jscHeap.heapSize,
    heapCapacity: jscHeap.heapCapacity,
    extraMemorySize: jscHeap.extraMemorySize,
    objectCount: jscHeap.objectCount,
    formatted: {
      heapSize: formatMemoryBytes(jscHeap.heapSize),
      heapCapacity: formatMemoryBytes(jscHeap.heapCapacity),
      extraMemorySize: formatMemoryBytes(jscHeap.extraMemorySize),
    },
  },
  systemMemory: {
    ...report.memory,
    formatted: {
      total: formatMemoryBytes(report.memory.totalBytes),
      used: formatMemoryBytes(report.memory.usedBytes),
      free: formatMemoryBytes(report.memory.freeBytes),
    },
  },
  project: meta.name
    ? { name: meta.name, version: meta.version, engineRange, packageManager: meta.packageManager }
    : undefined,
  packageManager: meta.packageManager,
  runtime: deepReport?.runtime,
  workspace: deepReport?.workspace,
  editor: deepReport?.editor,
  utilsCoverage: deepReport?.utilsCoverage,
  utilsDocProbe: deepReport?.utilsDocProbe,
  bunDocsMcp: deepReport?.bunDocsMcp,
  mimalloc: undefined as
    | {
        script: string;
        available: boolean;
        raw: string;
        parsed: ReturnType<typeof parseMimallocStats>;
        exitCode: number | null;
      }
    | undefined,
};

if (mimallocScript) {
  const stats = await captureMimallocStats(mimallocScript, { timeout: 30_000 });
  const raw = stats.combined;
  const parsed = parseMimallocStats(raw);
  payload.mimalloc = {
    script: mimallocScript,
    available: parsed !== undefined,
    raw,
    parsed,
    exitCode: stats.exitCode,
  };
}

if (json) {
  console.log(JSON.stringify(payload, null, 2));
} else if (pretty) {
  console.log(
    formatFullBunRuntimeSnapshot(engineRange, {
      packageManager: meta.packageManager,
      projectName: meta.name,
      projectVersion: meta.version,
      processMemory,
    })
  );
  if (deepReport?.editor) console.log(`\n${formatEditorRuntimeSnapshot(deepReport.editor)}`);
  if (deepReport?.workspace)
    console.log(`\n${formatWorkspaceRuntimeSnapshot(deepReport.workspace)}`);
  if (deepReport?.utilsCoverage) {
    const c = deepReport.utilsCoverage;
    console.log(
      `\nutils:      ${c.wrapped} wrapped · ${c.partial} partial · ${c.nativeOnly} native (${c.coveragePercent}% coverage)`
    );
    console.log(`  docs:       ${c.docUrl}`);
    if (deepReport.utilsDocProbe) {
      const p = deepReport.utilsDocProbe;
      console.log(`  doc-probe:  ${p.ok ? "ok" : "fail"} · ${p.command}`);
    }
  }
  if (deepReport?.bunDocsMcp) {
    const m = deepReport.bunDocsMcp;
    console.log(
      `\nbun-docs:   ${m.ok ? "ok" : "fail"} · ${m.tools?.length ?? 0} tool(s) · ${m.latencyMs}ms${m.cached ? " cached" : ""}`
    );
    if (m.error) console.log(`  error:      ${m.error}`);
  }
  if (payload.mimalloc) {
    console.log("\n--- mimalloc stats ---");
    if (payload.mimalloc.available) console.log(payload.mimalloc.raw);
    else {
      console.log(
        `(mimalloc stats unavailable for ${payload.mimalloc.script}; exitCode=${payload.mimalloc.exitCode})`
      );
    }
  }
} else {
  console.log(inspectBunRuntime());
}
