/**
 * runtime/utils.mdx wrapper coverage — dashboard API.
 */

import { buildDeepRuntimeReport } from "../../../../src/lib/runtime-introspection.ts";
import { jsonResponse } from "./shared.ts";

export async function apiRuntimeUtilsCoverage(): Promise<Response> {
  const report = await buildDeepRuntimeReport({ probeMcp: true, probeUtilsDocs: true });
  return jsonResponse({
    ...report.utilsCoverage,
    runtime: {
      version: report.runtime.version,
      revision: report.runtime.revisionShort,
      channel: report.runtime.channel,
      main: report.runtime.main,
    },
    editor: report.editor,
    workspace: report.workspace,
    bunDocsMcp: report.bunDocsMcp,
    utilsDocProbe: report.utilsDocProbe,
    fetchedAt: report.fetchedAt,
  });
}
