/**
 * Routes wired in examples/dashboard/src/index.ts (outside handlers/routes.ts).
 */

import { DASHBOARD_COOKIE_ROUTE_PATHS } from "./serve-cookies.ts";
import { DASHBOARD_WS_PATH } from "./serve-websocket.ts";

export interface DashboardServeRoute {
  path: string;
  methods: readonly ("GET" | "POST" | "HEAD")[];
  wiredIn: "index.ts routes" | "index.ts fetch";
  note?: string;
}

/** Bun.serve routes + fetch-only paths not duplicated in handlers/routes.ts. */
export const DASHBOARD_SERVE_ROUTES: readonly DashboardServeRoute[] = [
  {
    path: DASHBOARD_COOKIE_ROUTE_PATHS.login,
    methods: ["GET", "POST"],
    wiredIn: "index.ts routes",
    note: "req.cookies.set — auto Set-Cookie",
  },
  {
    path: DASHBOARD_COOKIE_ROUTE_PATHS.profile,
    methods: ["GET"],
    wiredIn: "index.ts routes",
    note: "req.cookies.get",
  },
  {
    path: DASHBOARD_COOKIE_ROUTE_PATHS.logout,
    methods: ["GET", "POST"],
    wiredIn: "index.ts routes",
    note: "req.cookies.delete",
  },
  {
    path: DASHBOARD_WS_PATH,
    methods: ["GET"],
    wiredIn: "index.ts fetch",
    note: "WebSocket upgrade or JSON subscriber probe",
  },
] as const;

export const DASHBOARD_SERVE_ROUTE_PATHS = new Set(
  DASHBOARD_SERVE_ROUTES.map((route) => route.path)
);
