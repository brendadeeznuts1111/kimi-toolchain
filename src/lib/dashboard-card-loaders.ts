/**
 * Generated card loader stubs — registry panels without a dashboard.js loader.
 */

import { join } from "path";
import { dashboardScriptPath, loadDashboardCards } from "./dashboard-card-registry.ts";
import { pathExists, readText } from "./bun-io.ts";

export const DASHBOARD_CARD_LOADERS_BEGIN = "// DASHBOARD_CARD_LOADERS:AUTO";
export const DASHBOARD_CARD_LOADERS_END = "// /DASHBOARD_CARD_LOADERS:AUTO";

const CARD_LOADER_RE = /card\("(card-[^"]+)"/g;
const SPECIAL_LOADERS: Array<{ id: string; marker: string }> = [
  { id: "card-effect-benchmark", marker: "loadEffectBenchmarkCard" },
  { id: "card-artifacts", marker: "card-artifacts-body" },
];

function loaderIdsFromScript(script: string): Set<string> {
  const ids = new Set([...script.matchAll(CARD_LOADER_RE)].map((m) => m[1]!));
  for (const { id, marker } of SPECIAL_LOADERS) {
    if (script.includes(marker)) ids.add(id);
  }
  return ids;
}

function resolveDashboardLoaderScript(repoRoot: string): string {
  const corePath = join(repoRoot, "examples/dashboard/src/dashboard-core.js");
  const jsPath = dashboardScriptPath(repoRoot);
  const loaderDir = join(repoRoot, "examples/dashboard/src/dashboard-loaders");
  const parts: string[] = [];
  if (pathExists(corePath)) parts.push(readText(corePath));
  if (pathExists(jsPath)) parts.push(readText(jsPath));
  if (pathExists(loaderDir)) {
    for (const file of [...new Bun.Glob("*.js").scanSync(loaderDir)].sort()) {
      parts.push(readText(join(loaderDir, file)));
    }
  }
  return parts.join("\n");
}

/** Registry cards that lack a loader in dashboard shell scripts. */
export function missingCardLoaders(
  repoRoot: string
): Array<{ id: string; apiRoute: string | null }> {
  const cards = loadDashboardCards(repoRoot);
  const script = resolveDashboardLoaderScript(repoRoot);
  const loaders = loaderIdsFromScript(script);
  return cards.filter((c) => !loaders.has(c.id)).map((c) => ({ id: c.id, apiRoute: c.apiRoute }));
}

export function renderCardLoaderStub(id: string, apiRoute: string | null): string {
  const route = apiRoute ?? "/api/unknown";
  const label = id.replace(/^card-/, "");
  return `// ${label} (generated stub)
(async () => {
  try {
    const d = await fetchJson("${route}");
    const body = typeof d === "object" && d !== null
      ? \`<pre style="font-size:10px;max-height:240px;overflow:auto">\${JSON.stringify(d, null, 2).slice(0, 4000)}</pre>\`
      : \`<p class="status ok">\${String(d)}</p>\`;
    card("${id}", body);
  } catch (e) {
    card("${id}", \`<p class="status err">\${e.message}</p>\`);
  }
})();`;
}

export function renderCardLoaderBlock(
  cards: Array<{ id: string; apiRoute: string | null }>
): string {
  if (cards.length === 0) {
    return `${DASHBOARD_CARD_LOADERS_BEGIN}\n${DASHBOARD_CARD_LOADERS_END}`;
  }
  const body = cards.map((c) => renderCardLoaderStub(c.id, c.apiRoute)).join("\n\n");
  return `${DASHBOARD_CARD_LOADERS_BEGIN}\n${body}\n${DASHBOARD_CARD_LOADERS_END}`;
}

export function syncDashboardCardLoaders(
  repoRoot: string,
  options: { check?: boolean } = {}
): string[] {
  const violations: string[] = [];
  const missing = missingCardLoaders(repoRoot);
  const jsPath = dashboardScriptPath(repoRoot);
  const script = readText(jsPath);
  const expectedBlock = renderCardLoaderBlock(missing);

  const blockRe = new RegExp(
    `${escapeRegExp(DASHBOARD_CARD_LOADERS_BEGIN)}[\\s\\S]*?${escapeRegExp(DASHBOARD_CARD_LOADERS_END)}`
  );

  if (!blockRe.test(script)) {
    violations.push("dashboard.js missing DASHBOARD_CARD_LOADERS markers");
    return violations;
  }

  const current = script.match(blockRe)?.[0];
  if (options.check) {
    if (current !== expectedBlock && missing.length > 0) {
      violations.push(
        `dashboard.js card loaders stale — ${missing.length} registry loader(s) missing: ${missing.map((c) => c.id).join(", ")}`
      );
    }
    return violations;
  }

  if (current !== expectedBlock) {
    Bun.write(jsPath, script.replace(blockRe, expectedBlock));
  }
  return violations;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
