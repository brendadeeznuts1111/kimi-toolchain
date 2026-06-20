#!/usr/bin/env bun
/**
 * Slice 1 — mechanical test hygiene fixes (zero behavior change):
 * - process.env → Bun.env (excludes mcp-config; refactor that file to withEnv manually)
 * - local REPO_ROOT → import from test/helpers.ts
 */
import { join } from "path";

const ROOT = join(import.meta.dir, "..");
const REPO_ROOT_LINE =
  /^\s*const\s+REPO_ROOT\s*=\s*join\s*\(\s*import\.meta\.dir\s*,\s*["']\.\.["']\s*\)\s*;?\s*$/m;
const HELPERS_IMPORT = /from\s+["'](?:\.\/|\.\.\/)?helpers\.ts["']/;
const PROCESS_ENV_SKIP = new Set(["test/mcp-config.unit.test.ts"]);

function fixRepoRoot(content: string): string {
  const lines = content.split("\n");
  const next: string[] = [];
  let removed = false;

  for (const line of lines) {
    if (REPO_ROOT_LINE.test(line)) {
      removed = true;
      continue;
    }
    next.push(line);
  }
  if (!removed) return content;

  let updated = next.join("\n");
  if (HELPERS_IMPORT.test(updated)) {
    updated = updated.replace(
      /import\s*\{([^}]+)\}\s*from\s+["'](?:\.\/|\.\.\/)?helpers\.ts["'];/,
      (_match, imports: string) => {
        const names = imports
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (names.includes("REPO_ROOT")) return _match;
        return `import { REPO_ROOT,${imports}} from "./helpers.ts";`;
      }
    );
  } else {
    const bunTestIdx = updated.search(/^import\s+.*from\s+["']bun:test["'];/m);
    const insert =
      bunTestIdx >= 0 ? updated.indexOf("\n", bunTestIdx) + 1 : updated.indexOf("\n") + 1;
    updated = `${updated.slice(0, insert)}import { REPO_ROOT } from "./helpers.ts";\n${updated.slice(insert)}`;
  }

  return updated;
}

function fixProcessEnv(content: string, rel: string): string {
  if (PROCESS_ENV_SKIP.has(rel)) return content;
  return content.replace(/\bprocess\.env\b/g, "Bun.env");
}

async function main(): Promise<void> {
  const glob = new Bun.Glob("test/**/*.ts");
  let changed = 0;

  for await (const rel of glob.scan({ cwd: ROOT, onlyFiles: true })) {
    const path = join(ROOT, rel);
    const original = await Bun.file(path).text();
    let updated = fixRepoRoot(original);
    updated = fixProcessEnv(updated, rel);

    if (updated !== original) {
      await Bun.write(path, updated);
      console.log(`✅ ${rel}`);
      changed++;
    }
  }

  console.log(`\n${changed} file(s) modified`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(
      "fix-test-hygiene-slice1 failed:",
      err instanceof Error ? err.message : String(err)
    );
    process.exit(1);
  });
}
