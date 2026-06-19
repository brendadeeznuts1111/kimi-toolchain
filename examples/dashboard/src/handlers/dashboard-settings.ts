import {
  resolveDashboardProjectRoot,
  resolveDashboardSettings,
} from "../../../../src/lib/dashboard-settings.ts";
import { jsonResponse } from "./api-handlers.ts";

export async function apiDashboardSettings(request: Request): Promise<Response> {
  const projectRoot = resolveDashboardProjectRoot(import.meta.dir);
  const settings = await resolveDashboardSettings(projectRoot, {
    requestUrl: new URL(request.url),
  });
  return jsonResponse(settings);
}
