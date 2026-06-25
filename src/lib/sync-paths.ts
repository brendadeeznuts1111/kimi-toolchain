/**
 * Repo ↔ desktop sync key resolution (single PREFIX_ROUTES table).
 */

import { collectLocalDocSyncPaths } from "./canonical-references.ts";
import {
  agentsSkillsRoot,
  canonicalRepoRoot,
  canvasesDir,
  desktopRoot,
  gatesDir,
  harnessDir,
  kimiHooksDir,
  libDir,
  scriptsDir,
  skillsDir,
  toolsDir,
} from "./paths.ts";
import { join } from "path";

/** Manifest hash key prefixes — must match ~/.kimi-code/ layout. */
export const LABEL_PREFIX = {
  TOOLS: "tools/",
  LIB: "lib/",
  CANVASES: "canvases/",
  GATES: "gates/",
  HARNESS: "harness/",
  SCRIPTS: "scripts/",
  KIMI_HOOKS: "kimi-hooks/",
  TEMPLATES: "templates/",
  AGENTS_SKILL: "agents-skill/",
  KIMI_SKILL: "kimi-skill/",
} as const;

/** Root repo files synced to ~/.kimi-code/ but not in LOCAL_DOC_REFERENCES. */
export const SYNC_ROOT_INFRA = [
  "CONTRIBUTING.md",
  "dx.config.toml",
  "kimi-toolchain.code-workspace",
  "error-taxonomy.yml",
] as const;

type PrefixRoute = {
  prefix: string;
  repoSegments: string[];
  desktopDir: () => string;
};

const PREFIX_ROUTES: readonly PrefixRoute[] = [
  { prefix: LABEL_PREFIX.TOOLS, repoSegments: ["src", "bin"], desktopDir: toolsDir },
  { prefix: LABEL_PREFIX.LIB, repoSegments: ["src", "lib"], desktopDir: libDir },
  { prefix: LABEL_PREFIX.CANVASES, repoSegments: ["src", "canvases"], desktopDir: canvasesDir },
  { prefix: LABEL_PREFIX.GATES, repoSegments: ["src", "gates"], desktopDir: gatesDir },
  { prefix: LABEL_PREFIX.HARNESS, repoSegments: ["src", "harness"], desktopDir: harnessDir },
  { prefix: LABEL_PREFIX.SCRIPTS, repoSegments: ["scripts"], desktopDir: scriptsDir },
  {
    prefix: LABEL_PREFIX.KIMI_HOOKS,
    repoSegments: ["src", "kimi-hooks"],
    desktopDir: kimiHooksDir,
  },
  {
    prefix: LABEL_PREFIX.TEMPLATES,
    repoSegments: ["templates"],
    desktopDir: () => join(desktopRoot(), "templates"),
  },
  {
    prefix: LABEL_PREFIX.AGENTS_SKILL,
    repoSegments: ["skills", "kimi-toolchain"],
    desktopDir: () => join(agentsSkillsRoot(), "kimi-toolchain"),
  },
  {
    prefix: LABEL_PREFIX.KIMI_SKILL,
    repoSegments: ["skills", "kimi-toolchain"],
    desktopDir: () => join(skillsDir(), "kimi-toolchain"),
  },
];

function routeForKey(key: string): { route: PrefixRoute; rel: string } | null {
  for (const route of PREFIX_ROUTES) {
    if (key.startsWith(route.prefix)) {
      return { route, rel: key.slice(route.prefix.length) };
    }
  }
  return null;
}

/** Resolve a sync-managed desktop key to its repo source path (or null). */
export function resolveSyncManagedSourcePath(repoRoot: string, key: string): string | null {
  const root = canonicalRepoRoot(repoRoot);
  const match = routeForKey(key);
  if (match) {
    return join(root, ...match.route.repoSegments, match.rel);
  }
  if (
    collectLocalDocSyncPaths().includes(key) ||
    (SYNC_ROOT_INFRA as readonly string[]).includes(key)
  ) {
    return join(root, key);
  }
  return null;
}

/** Resolve a sync-managed key to its desktop install path (or null). */
export function resolveSyncManagedDesktopPath(key: string): string | null {
  const match = routeForKey(key);
  if (match) {
    return join(match.route.desktopDir(), match.rel);
  }
  if (
    collectLocalDocSyncPaths().includes(key) ||
    (SYNC_ROOT_INFRA as readonly string[]).includes(key)
  ) {
    return join(desktopRoot(), key);
  }
  return null;
}
