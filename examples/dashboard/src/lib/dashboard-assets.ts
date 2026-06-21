/**
 * Examples dashboard static assets — Bun.file responses for HTML/CSS/JS shell.
 */

import { join } from "path";

export const DASHBOARD_STATIC_ASSETS = ["dashboard.css", "dashboard-core.js", "dashboard.js"] as const;

export type DashboardStaticAsset = (typeof DASHBOARD_STATIC_ASSETS)[number];

const ASSET_DIR = join(import.meta.dir, "..");

const CONTENT_TYPES: Record<DashboardStaticAsset, string> = {
  "dashboard.css": "text/css; charset=utf-8",
  "dashboard-core.js": "application/javascript; charset=utf-8",
  "dashboard.js": "application/javascript; charset=utf-8",
};

export function dashboardAssetPath(name: DashboardStaticAsset): string {
  return join(ASSET_DIR, name);
}

export function dashboardAssetResponse(name: DashboardStaticAsset): Response {
  const file = Bun.file(dashboardAssetPath(name));
  return new Response(file, {
    headers: {
      "content-type": CONTENT_TYPES[name],
      "cache-control": "no-store",
    },
  });
}

export function isDashboardStaticAsset(pathname: string): pathname is `/${DashboardStaticAsset}` {
  const name = pathname.slice(1);
  return (DASHBOARD_STATIC_ASSETS as readonly string[]).includes(name);
}