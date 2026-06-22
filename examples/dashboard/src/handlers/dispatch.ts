/** Dashboard static route dispatch — route table SSOT in ./routes.ts */

import { ROUTE_BY_PATH } from "./routes.ts";
import { isAllowedMethod, methodNotAllowedJson } from "./shared.ts";

export { DASHBOARD_STATIC_ROUTES, ROUTE_BY_PATH } from "./routes.ts";

export async function dispatchDashboardRoute(req: Request): Promise<Response | null> {
  const path = new URL(req.url).pathname;
  const route = ROUTE_BY_PATH.get(path);
  if (!route) return null;

  if (!isAllowedMethod(req.method, route.methods)) {
    return methodNotAllowedJson(req.method, path, route.methods);
  }

  return route.handler(req);
}
