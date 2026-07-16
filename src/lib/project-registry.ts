/**
 * Project registry — global portfolio of managed codebases.
 *
 * Stored in ~/.kimi-code/var/sessions.db so it survives sessions
 * and is visible to all kimi-toolchain tools and future agents.
 */

import { getDb } from "./memory-sessions.ts";
import { readPackageManifest, resolveProjectRoot } from "./utils.ts";
import { isKimiToolchainRepo } from "./workspace-health.ts";
import type { ProjectRecord } from "./sessions-schema.ts";

export type { ProjectRecord };

export interface RegisterProjectOptions {
  alias?: string;
  runtime?: string;
  mcpProfile?: string;
  parentAlias?: string;
}

function runtimeFromPackage(pkg: Awaited<ReturnType<typeof readPackageManifest>>): string {
  if (pkg?.packageManager) return pkg.packageManager;
  if (pkg?.engines?.bun) return `bun@${pkg.engines.bun}`;
  if (pkg?.engines?.node) return `node@${pkg.engines.node}`;
  return "unknown";
}

export function makeProjectAlias(projectDir: string, packageName?: string): string {
  if (packageName && packageName.trim()) return packageName.trim();
  const base = projectDir.replace(/\/$/, "").split("/").pop();
  return base || "unknown";
}

export async function registerProject(
  projectDir: string,
  options: RegisterProjectOptions = {}
): Promise<ProjectRecord> {
  const root = await resolveProjectRoot(projectDir);
  const pkg = await readPackageManifest(root);
  const alias = options.alias ?? makeProjectAlias(root, pkg?.name);
  const packageName = pkg?.name ?? null;
  const runtime = options.runtime ?? runtimeFromPackage(pkg);
  const isToolchain = await isKimiToolchainRepo(root);
  const now = new Date().toISOString();

  using db = getDb();
  const existing = db.query("SELECT alias FROM projects WHERE root = ?").get(root) as {
    alias: string;
  } | null;

  if (existing) {
    db.run(
      `UPDATE projects
       SET package_name = ?, runtime = ?, last_seen_at = ?, mcp_profile = ?,
           is_toolchain_repo = ?, parent_alias = ?
       WHERE root = ?`,
      [
        packageName,
        runtime,
        now,
        options.mcpProfile ?? null,
        isToolchain ? 1 : 0,
        options.parentAlias ?? null,
        root,
      ]
    );
  } else {
    db.run(
      `INSERT INTO projects
       (alias, root, package_name, runtime, added_at, last_seen_at, mcp_profile, is_toolchain_repo, parent_alias)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        alias,
        root,
        packageName,
        runtime,
        now,
        now,
        options.mcpProfile ?? null,
        isToolchain ? 1 : 0,
        options.parentAlias ?? null,
      ]
    );
  }

  if (pkg?.workspaces && Array.isArray(pkg.workspaces)) {
    await registerWorkspaceMembers(root, alias);
  }

  return {
    alias,
    root,
    packageName,
    runtime,
    addedAt: now,
    lastSeenAt: now,
    mcpProfile: options.mcpProfile ?? null,
    isToolchainRepo: isToolchain,
    parentAlias: options.parentAlias ?? null,
  };
}

export async function registerWorkspaceMembers(
  parentRoot: string,
  parentAlias: string
): Promise<void> {
  const pkg = await readPackageManifest(parentRoot);
  const patterns = pkg?.workspaces;
  if (!Array.isArray(patterns)) return;

  for (const pattern of patterns) {
    if (typeof pattern !== "string") continue;
    // Minimal glob expansion for workspace patterns like "examples/*"
    const base = pattern.replace(/\/\*+$/, "");
    const basePath = `${parentRoot}/${base}`;
    try {
      const entries = Array.from(new Bun.Glob("*").scanSync({ cwd: basePath }));
      for (const entry of entries) {
        const childRoot = `${basePath}/${entry}`;
        const stat = await Bun.file(childRoot).stat();
        if (!stat?.isDirectory()) continue;
        const childPkg = await readPackageManifest(childRoot);
        if (!childPkg?.name) continue;
        await registerProject(childRoot, {
          alias: childPkg.name,
          parentAlias: parentAlias,
        });
      }
    } catch {
      // ignore unreadable workspace dirs
    }
  }
}

export function getProjectByRoot(root: string): ProjectRecord | null {
  using db = getDb();
  const row = db.query("SELECT * FROM projects WHERE root = ?").get(root) as Record<
    string,
    unknown
  > | null;
  return row ? rowToProject(row) : null;
}

export function getProjectByAlias(alias: string): ProjectRecord | null {
  using db = getDb();
  const row = db.query("SELECT * FROM projects WHERE alias = ?").get(alias) as Record<
    string,
    unknown
  > | null;
  return row ? rowToProject(row) : null;
}

export function listProjects(): ProjectRecord[] {
  using db = getDb();
  const rows = db.query("SELECT * FROM projects ORDER BY last_seen_at DESC").all() as Record<
    string,
    unknown
  >[];
  return rows.map(rowToProject);
}

export function resolveRegisteredProject(cwd: string = Bun.cwd): ProjectRecord | null {
  using db = getDb();
  const rows = db.query("SELECT * FROM projects ORDER BY length(root) DESC").all() as Record<
    string,
    unknown
  >[];
  for (const row of rows) {
    const project = rowToProject(row);
    if (cwd === project.root || cwd.startsWith(`${project.root}/`)) {
      return project;
    }
  }
  return null;
}

export function unregisterProject(alias: string): boolean {
  using db = getDb();
  const result = db.run("DELETE FROM projects WHERE alias = ?", [alias]);
  return (result.changes ?? 0) > 0;
}

export async function autoRegisterProject(projectDir: string = Bun.cwd): Promise<ProjectRecord> {
  const root = await resolveProjectRoot(projectDir);
  const existing = getProjectByRoot(root);
  if (existing) {
    // Refresh last_seen_at and any package metadata; preserve mcpProfile hint.
    return registerProject(root, { mcpProfile: existing.mcpProfile ?? undefined });
  }
  return registerProject(root);
}

function rowToProject(row: Record<string, unknown>): ProjectRecord {
  return {
    alias: String(row.alias),
    root: String(row.root),
    packageName: row.package_name ? String(row.package_name) : null,
    runtime: row.runtime ? String(row.runtime) : null,
    addedAt: String(row.added_at),
    lastSeenAt: String(row.last_seen_at),
    mcpProfile: row.mcp_profile ? String(row.mcp_profile) : null,
    isToolchainRepo: row.is_toolchain_repo === 1 || row.is_toolchain_repo === true,
    parentAlias: row.parent_alias ? String(row.parent_alias) : null,
  };
}
