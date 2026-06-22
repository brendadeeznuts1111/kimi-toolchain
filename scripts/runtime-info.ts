#!/usr/bin/env bun
/** Enhanced replacement for `bun -e 'console.log({ version: Bun.version, ... })'`. */
import { join } from "path";
import {
  bunRuntimeReport,
  formatFullBunRuntimeSnapshot,
  formatMemoryBytes,
  formatProcessMemoryUsage,
  inspectBunRuntime,
  processMemoryUsage,
} from "../src/lib/bun-utils.ts";
import { captureMimallocStats, parseMimallocStats } from "../src/lib/memory/governor.ts";

function parseArg(name: string): string | undefined {
  const prefix = `${name}=`;
  const flagged = Bun.argv.find((a) => a.startsWith(prefix));
  if (flagged) return flagged.slice(prefix.length);
  const index = Bun.argv.indexOf(name);
  if (index >= 0 && index + 1 < Bun.argv.length) return Bun.argv[index + 1];
  return undefined;
}

const json = Bun.argv.includes("--json");
const pretty = Bun.argv.includes("--pretty") || (!json && Bun.argv.length <= 2);
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

function processMemoryBreakdown(mem: typeof processMemory) {
  const rss = mem.rss || 1; // avoid divide-by-zero
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
    ? {
        name: meta.name,
        version: meta.version,
        engineRange,
        packageManager: meta.packageManager,
      }
    : undefined,
  packageManager: meta.packageManager,
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
  payload.mimalloc = {
    script: mimallocScript,
    available: raw.length > 0,
    raw,
    parsed: parseMimallocStats(raw),
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
  if (payload.mimalloc) {
    console.log("\n--- mimalloc stats ---");
    if (payload.mimalloc.available) {
      console.log(payload.mimalloc.raw);
    } else {
      console.log(
        `(mimalloc stats unavailable for ${payload.mimalloc.script}; exitCode=${payload.mimalloc.exitCode})`
      );
    }
  }
} else {
  console.log(inspectBunRuntime());
}
