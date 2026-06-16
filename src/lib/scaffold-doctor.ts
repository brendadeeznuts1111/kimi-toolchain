/**
 * Scaffold completeness checks for kimi-fix doctor.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { REQUIRED_PACKAGE_SCRIPTS } from "./scaffold-templates.ts";
import type { HealthCheck as DoctorCheck } from "./health-check.ts";

function readDxWorkflowPath(projectDir: string): string {
  const dxPath = join(projectDir, "dx.config.toml");
  if (!existsSync(dxPath)) return ".github/workflows/ci.yml";
  try {
    const raw = Bun.TOML.parse(readFileSync(dxPath, "utf8")) as {
      github?: { workflow?: string };
    };
    return raw.github?.workflow ?? ".github/workflows/ci.yml";
  } catch {
    return ".github/workflows/ci.yml";
  }
}

export async function checkScaffold(projectDir: string): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  const workflowPath = readDxWorkflowPath(projectDir);
  const ciDisabled = workflowPath.includes("workflows-disabled");

  const fileChecks: Array<{ name: string; rel: string }> = [
    { name: "AGENTS.md", rel: "AGENTS.md" },
    { name: "CODE_REFERENCES.md", rel: "CODE_REFERENCES.md" },
    { name: "tsconfig.json", rel: "tsconfig.json" },
    { name: "bunfig.toml", rel: "bunfig.toml" },
    { name: "dx.config.toml", rel: "dx.config.toml" },
    { name: "mcp.json", rel: ".kimi-code/mcp.json" },
    { name: "check.ts", rel: "scripts/check.ts" },
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

  const ciPresent = existsSync(join(projectDir, workflowPath));
  checks.push({
    name: "ci.yml",
    status: ciPresent ? "ok" : ciDisabled ? "ok" : "warn",
    message: ciPresent
      ? `present at ${workflowPath}`
      : ciDisabled
        ? `disabled (server CI unavailable) — configured at ${workflowPath}`
        : `missing — run kimi-fix`,
    fixable: !ciPresent && !ciDisabled,
  });

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
