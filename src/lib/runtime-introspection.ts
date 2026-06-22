/**
 * Unified deep runtime snapshot — Bun + workspace + editor + utils coverage + optional MCP probe.
 */

import {
  buildRuntimeUtilsCoverageReport,
  RUNTIME_UTILS_DOCS_PROBE_COMMAND,
} from "./bun-runtime-utils-coverage.ts";
import {
  formatBunDocsContent,
  probeBunDocsCached,
  queryBunDocsFilesystem,
} from "./bun-docs-mcp.ts";
import { inspectBunRuntime, inspectEditorRuntime } from "./bun-utils.ts";
import { inspectWorkspaceRuntime } from "./workspace-runtime.ts";

export interface DeepRuntimeReport {
  runtime: ReturnType<typeof inspectBunRuntime>;
  editor: Awaited<ReturnType<typeof inspectEditorRuntime>>;
  workspace: Awaited<ReturnType<typeof inspectWorkspaceRuntime>>;
  utilsCoverage: ReturnType<typeof buildRuntimeUtilsCoverageReport>;
  bunDocsMcp?: {
    ok: boolean;
    tools?: string[];
    latencyMs: number;
    cached: boolean;
    error?: string;
  };
  utilsDocProbe?: {
    ok: boolean;
    command: string;
    latencyMs: number;
    error?: string;
    excerpt?: string;
  };
  fetchedAt: string;
}

/** Collect the full deep runtime stack in one call. */
async function probeBunDocsMcpReport(timeoutMs: number): Promise<DeepRuntimeReport["bunDocsMcp"]> {
  const r = await probeBunDocsCached(timeoutMs);
  return {
    ok: r.ok,
    tools: r.tools,
    latencyMs: r.latencyMs,
    cached: r.cached ?? false,
    error: r.error,
  };
}

async function probeUtilsDocsReport(
  timeoutMs: number
): Promise<DeepRuntimeReport["utilsDocProbe"]> {
  const r = await queryBunDocsFilesystem(RUNTIME_UTILS_DOCS_PROBE_COMMAND, timeoutMs);
  return {
    ok: r.ok,
    command: RUNTIME_UTILS_DOCS_PROBE_COMMAND,
    latencyMs: r.latencyMs,
    error: r.error,
    excerpt: r.ok ? formatBunDocsContent(r.content).slice(0, 240) : undefined,
  };
}

export async function buildDeepRuntimeReport(options?: {
  probeMcp?: boolean;
  probeUtilsDocs?: boolean;
  mcpTimeoutMs?: number;
}): Promise<DeepRuntimeReport> {
  const timeoutMs = options?.mcpTimeoutMs ?? 15000;
  const [editor, workspace, bunDocsMcp, utilsDocProbe] = await Promise.all([
    inspectEditorRuntime(),
    inspectWorkspaceRuntime(),
    options?.probeMcp ? probeBunDocsMcpReport(timeoutMs) : Promise.resolve(undefined),
    options?.probeUtilsDocs ? probeUtilsDocsReport(timeoutMs) : Promise.resolve(undefined),
  ]);

  return {
    runtime: inspectBunRuntime(),
    editor,
    workspace,
    utilsCoverage: buildRuntimeUtilsCoverageReport(),
    bunDocsMcp,
    utilsDocProbe,
    fetchedAt: new Date().toISOString(),
  };
}
