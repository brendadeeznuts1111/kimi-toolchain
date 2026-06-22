/**
 * runtime/utils.mdx coverage — maps Bun utils APIs to kimi-toolchain wrappers.
 */
import { BUN_RUNTIME_UTILS_DOC_URL } from "./bun-utils.ts";

export { BUN_RUNTIME_UTILS_DOC_URL };

export type RuntimeUtilsCoverageStatus = "wrapped" | "native-only" | "partial";

export interface RuntimeUtilsCoverageEntry {
  api: string;
  anchor: string;
  wrapper?: string;
  module?: string;
  docUrlConst?: string;
  status: RuntimeUtilsCoverageStatus;
  notes?: string;
}

export const RUNTIME_UTILS_COVERAGE: readonly RuntimeUtilsCoverageEntry[] = [
  {
    api: "Bun.version",
    anchor: "bun-version",
    wrapper: "detectBunRuntime",
    module: "src/lib/bun-utils.ts",
    status: "wrapped",
  },
  {
    api: "Bun.revision",
    anchor: "bun-revision",
    wrapper: "detectBunRuntime",
    module: "src/lib/bun-utils.ts",
    status: "wrapped",
  },
  { api: "Bun.env", anchor: "bun-env", status: "native-only" },
  {
    api: "Bun.main",
    anchor: "bun-main",
    wrapper: "entryScriptPath / isDirectRun",
    module: "src/lib/bun-utils.ts",
    status: "wrapped",
  },
  {
    api: "Bun.sleep",
    anchor: "bun-sleep",
    wrapper: "sleep",
    module: "src/lib/bun-utils.ts",
    status: "wrapped",
  },
  {
    api: "Bun.sleepSync",
    anchor: "bun-sleepsync",
    wrapper: "sleepSync",
    module: "src/lib/bun-utils.ts",
    status: "wrapped",
  },
  {
    api: "Bun.which",
    anchor: "bun-which",
    wrapper: "resolveExecutable",
    module: "src/lib/bun-utils.ts",
    status: "wrapped",
  },
  {
    api: "Bun.randomUUIDv7",
    anchor: "bun-randomuuidv7",
    wrapper: "randomUUIDv7",
    module: "src/lib/bun-utils.ts",
    status: "wrapped",
  },
  {
    api: "Bun.stringWidth",
    anchor: "bun-stringwidth",
    wrapper: "terminalWidth",
    module: "src/lib/bun-utils.ts",
    status: "wrapped",
  },
  {
    api: "Bun.escapeHTML",
    anchor: "bun-escapehtml",
    wrapper: "escapeHtml",
    module: "src/lib/bun-utils.ts",
    status: "wrapped",
  },
  {
    api: "Bun.openInEditor",
    anchor: "bun-openineditor",
    wrapper: "openFileInEditor",
    module: "src/lib/bun-utils.ts",
    docUrlConst: "BUN_OPEN_IN_EDITOR_DOC_URL",
    status: "wrapped",
  },
  {
    api: "Bun.fileURLToPath",
    anchor: "bun-fileurltopath",
    wrapper: "filePathFromUrl",
    module: "src/lib/bun-utils.ts",
    status: "wrapped",
  },
  {
    api: "Bun.pathToFileURL",
    anchor: "bun-pathtofileurl",
    wrapper: "fileUrlFromPath",
    module: "src/lib/bun-utils.ts",
    status: "wrapped",
  },
  {
    api: "Bun.gzipSync",
    anchor: "bun-gzipsync",
    wrapper: "gzipBytes",
    module: "src/lib/bun-utils.ts",
    status: "wrapped",
  },
  {
    api: "serialize (bun:jsc)",
    anchor: "serialize-deserialize-in-bun-jsc",
    wrapper: "structuredCloneSerialize",
    module: "src/lib/bun-utils.ts",
    status: "wrapped",
  },
  {
    api: "estimateShallowMemoryUsageOf (bun:jsc)",
    anchor: "estimateshallowmemoryusageof-in-bun-jsc",
    wrapper: "estimateShallowMemoryUsage",
    module: "src/lib/bun-utils.ts",
    status: "wrapped",
  },
  {
    api: "Bun.peek",
    anchor: "bun-peek",
    wrapper: "peekPromise",
    module: "src/lib/bun-utils.ts",
    status: "wrapped",
  },
  {
    api: "Bun.nanoseconds",
    anchor: "bun-nanoseconds",
    wrapper: "nowNanos",
    module: "src/lib/bun-utils.ts",
    status: "wrapped",
  },
  { api: "Bun.color", anchor: "bun-color", module: "src/lib/error-format.ts", status: "partial" },
  {
    api: "Bun.wrapAnsi",
    anchor: "bun-wrapansi",
    module: "src/lib/bun-install-config.ts",
    status: "partial",
  },
] as const;

export const RUNTIME_UTILS_DOCS_PROBE_COMMAND = "rg openInEditor runtime/utils.mdx";

export function buildRuntimeUtilsCoverageReport() {
  const entries = [...RUNTIME_UTILS_COVERAGE];
  const wrapped = entries.filter((e) => e.status === "wrapped").length;
  const partial = entries.filter((e) => e.status === "partial").length;
  const nativeOnly = entries.filter((e) => e.status === "native-only").length;
  const total = entries.length;
  const coveragePercent =
    total > 0 ? Math.round(((wrapped + partial * 0.5) / total) * 1000) / 10 : 0;
  return {
    docUrl: BUN_RUNTIME_UTILS_DOC_URL,
    total,
    wrapped,
    partial,
    nativeOnly,
    coveragePercent,
    entries,
  };
}
