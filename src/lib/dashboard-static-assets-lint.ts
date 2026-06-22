/**
 * Lint examples/dashboard shell — external CSS/JS only (no inline blocks).
 */

import { join } from "path";
import { DASHBOARD_STATIC_ASSETS } from "../../examples/dashboard/src/lib/dashboard-assets.ts";
import { DASHBOARD_HTML_REL } from "./dashboard-card-registry.ts";
import { pathExists, readText } from "./bun-io.ts";

export function lintDashboardStaticAssets(repoRoot: string): string[] {
  const violations: string[] = [];
  const htmlPath = join(repoRoot, DASHBOARD_HTML_REL);
  const html = readText(htmlPath);

  if (/<style[\s>]/i.test(html)) {
    violations.push("dashboard.html must not contain inline <style> — use /dashboard.css");
  }
  if (/<script(?![^>]*\ssrc=)[^>]*>/i.test(html)) {
    violations.push("dashboard.html must not contain inline <script> — use /dashboard.js");
  }

  for (const asset of DASHBOARD_STATIC_ASSETS) {
    const href = `/${asset}`;
    if (!html.includes(href)) {
      violations.push(`dashboard.html missing reference to ${href}`);
    }
    const assetPath = join(repoRoot, "examples/dashboard/src", asset);
    if (!pathExists(assetPath)) {
      violations.push(`missing static asset file: examples/dashboard/src/${asset}`);
    }
  }

  return violations;
}
