/**
 * MCP-facing Bun version policy — pin + engines range from install audit SSOT.
 * @see https://bun.com/docs/runtime/semver
 */

import { join } from "path";
import { pathExists } from "./bun-io.ts";
import {
  auditBunInstallConfig,
  BUN_SEMVER_DOC_URL,
  describeBunVersionPolicy,
  type BunVersionPolicySnapshot,
} from "./bun-install-config.ts";

export interface McpVersionPolicyRow {
  key: string;
  status: string;
  current: string | null;
  hardened: string;
}

export interface McpVersionPolicyReport {
  projectRoot: string;
  semverDocUrl: string;
  policy: BunVersionPolicySnapshot;
  installAuditOk: boolean;
  packageJsonPolicy: McpVersionPolicyRow[];
}

export async function buildMcpVersionPolicyReport(
  projectRoot: string
): Promise<McpVersionPolicyReport> {
  const pkgPath = join(projectRoot, "package.json");
  let enginesBun: string | null = null;
  let packageManager: string | null = null;

  if (pathExists(pkgPath)) {
    const pkg = (await Bun.file(pkgPath).json()) as {
      engines?: { bun?: string };
      packageManager?: string;
    };
    enginesBun = pkg.engines?.bun ?? null;
    packageManager = pkg.packageManager ?? null;
  }

  const policy = describeBunVersionPolicy({ enginesBun, packageManager });
  const installAudit = await auditBunInstallConfig(projectRoot);

  return {
    projectRoot,
    semverDocUrl: BUN_SEMVER_DOC_URL,
    policy,
    installAuditOk: installAudit.ok,
    packageJsonPolicy: installAudit.tables["package-json"]
      .filter((row) => row.key === "packageManager" || row.key === "engines.bun")
      .map((row) => ({
        key: row.key,
        status: row.status,
        current: row.current,
        hardened: row.hardenedDefault,
      })),
  };
}
