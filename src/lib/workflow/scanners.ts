/**
 * workflow/scanners.ts — Built-in workflow scanners.
 */

import { join } from "path";
import { pathExists } from "../bun-io.ts";
import { readPackageManifest } from "../utils.ts";
import type { ScannerFn, ScannerIssue } from "./types.ts";

const SEMVER_PKG_RE = /^(.+?)@(.+?)\s/;

export function parseSemverIssueMessage(message: string): { pkg: string; version: string } | null {
  const match = message.match(SEMVER_PKG_RE);
  if (!match) return null;
  return { pkg: match[1], version: match[2] };
}

/** Flag dependencies whose version does not satisfy a simple caret baseline. */
export const semverScanner: ScannerFn = async ({ projectRoot }) => {
  const pkgPath = join(projectRoot, "package.json");
  const issues: ScannerIssue[] = [];

  if (!pathExists(pkgPath)) {
    return {
      scannerId: "semver",
      status: "warn",
      issues: [{ severity: "medium", message: "missing package.json" }],
    };
  }

  const pkg = await readPackageManifest(projectRoot);
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };

  for (const [name, range] of Object.entries(deps ?? {})) {
    if (range.startsWith("workspace:") || range.startsWith("file:")) continue;
    if (/^\d+\.\d+\.\d+/.test(range) && range.includes("0.0.0")) {
      issues.push({
        severity: "critical",
        message: `${name}@${range} violates semver policy`,
        package: name,
        currentVersion: range,
      });
    }
  }

  return {
    scannerId: "semver",
    status: issues.some((issue) => issue.severity === "critical" || issue.severity === "high")
      ? "error"
      : issues.length > 0
        ? "warn"
        : "ok",
    issues,
    data: { dependencyCount: Object.keys(deps ?? {}).length },
  };
};

export const BUILTIN_SCANNERS: Record<string, ScannerFn> = {
  semver: semverScanner,
};

export function resolveScanners(ids?: string[]): ScannerFn[] {
  const selected = ids?.length ? ids : Object.keys(BUILTIN_SCANNERS);
  return selected.map((id) => {
    const scanner = BUILTIN_SCANNERS[id];
    if (!scanner) throw new Error(`unknown scanner: ${id}`);
    return scanner;
  });
}
