/**
 * Examples dashboard static assets — Bun.file responses for HTML/CSS/JS shell.
 */

import { join } from "path";

export const DASHBOARD_STATIC_ASSETS = [
  "dashboard.css",
  "dashboard-core.js",
  "dashboard-loader-lanes.js",
  "dashboard.js",
] as const;

export type DashboardStaticAsset = (typeof DASHBOARD_STATIC_ASSETS)[number];

/** Lazy-loaded card loader lanes (dashboard-core.js IntersectionObserver). */
export const DASHBOARD_LOADER_LANES = [
  "perf",
  "governance",
  "toolchain",
  "runtime",
  "identity",
] as const;

export type DashboardLoaderLane = (typeof DASHBOARD_LOADER_LANES)[number];

const ASSET_DIR = join(import.meta.dir, "..");
const LOADER_DIR = join(ASSET_DIR, "dashboard-loaders");

const CONTENT_TYPES: Record<DashboardStaticAsset, string> = {
  "dashboard.css": "text/css; charset=utf-8",
  "dashboard-core.js": "application/javascript; charset=utf-8",
  "dashboard-loader-lanes.js": "application/javascript; charset=utf-8",
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

export function dashboardLoaderPath(lane: DashboardLoaderLane): string {
  return join(LOADER_DIR, `${lane}.js`);
}

export function isDashboardLoaderPath(
  pathname: string
): pathname is `/dashboard-loaders/${DashboardLoaderLane}.js` {
  const match = pathname.match(/^\/dashboard-loaders\/([a-z]+)\.js$/);
  if (!match) return false;
  return (DASHBOARD_LOADER_LANES as readonly string[]).includes(match[1]!);
}

export function dashboardLoaderLaneFromPath(pathname: string): DashboardLoaderLane | null {
  const match = pathname.match(/^\/dashboard-loaders\/([a-z]+)\.js$/);
  const lane = match?.[1];
  if (!lane || !(DASHBOARD_LOADER_LANES as readonly string[]).includes(lane)) return null;
  return lane as DashboardLoaderLane;
}

export function dashboardLoaderResponse(lane: DashboardLoaderLane): Response {
  const file = Bun.file(dashboardLoaderPath(lane));
  return new Response(file, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/** Static routes for lazy loader lane modules. */
export function dashboardLoaderRoutes(): Array<{
  path: string;
  response: () => Response;
}> {
  return DASHBOARD_LOADER_LANES.map((lane) => ({
    path: `/dashboard-loaders/${lane}.js`,
    response: () => dashboardLoaderResponse(lane),
  }));
}
