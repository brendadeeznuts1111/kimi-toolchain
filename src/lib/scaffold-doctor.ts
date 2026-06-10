/**
 * Scaffold completeness checks for kimi-fix doctor.
 */

import { existsSync } from "fs";
import { join } from "path";
import { REQUIRED_PACKAGE_SCRIPTS } from "./scaffold-templates.ts";
import type { DoctorCheck } from "./utils.ts";

export async function checkScaffold(projectDir: string): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  const fileChecks: Array<{ name: string; rel: string }> = [
    { name: "AGENTS.md", rel: "AGENTS.md" },
    { name: "tsconfig.json", rel: "tsconfig.json" },
    { name: "bunfig.toml", rel: "bunfig.toml" },
    { name: "dx.config.toml", rel: "dx.config.toml" },
    { name: "mcp.json", rel: ".kimi-code/mcp.json" },
    { name: "check.ts", rel: "scripts/check.ts" },
    { name: "ci.yml", rel: ".github/workflows/ci.yml" },
    { name: "oxfmtrc", rel: ".oxfmtrc.json" },
    { name: "oxlintrc", rel: ".oxlintrc.json" },
  ];

  for (const { name, rel } of fileChecks) {
    const present = existsSync(join(projectDir, rel));
    checks.push({
      name,
      status: present ? "ok" : "warn",
      message: present ? "present" : "missing — run kimi-fix",
      fixable: !present,
    });
  }

  const pkgPath = join(projectDir, "package.json");
  if (!existsSync(pkgPath)) {
    checks.push({
      name: "package.json",
      status: "error",
      message: "missing",
      fixable: false,
    });
    return checks;
  }

  try {
    const pkg = (await Bun.file(pkgPath).json()) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts || {};
    const missingScripts = REQUIRED_PACKAGE_SCRIPTS.filter((s) => !scripts[s]);
    checks.push({
      name: "package-scripts",
      status: missingScripts.length === 0 ? "ok" : "warn",
      message:
        missingScripts.length === 0
          ? "quality scripts defined"
          : `missing: ${missingScripts.join(", ")}`,
      fixable: missingScripts.length > 0,
    });
  } catch {
    checks.push({
      name: "package.json",
      status: "error",
      message: "invalid JSON",
      fixable: false,
    });
  }

  return checks;
}
