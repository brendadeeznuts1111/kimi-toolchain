import { pathExists } from "./bun-io.ts";
import { join } from "path";

export interface GovernanceCheck {
  hasLicense: boolean;
  hasContributing: boolean;
  hasCodeowners: boolean;
  hasReadme: boolean;
  hasContext: boolean;
  hasChangelog: boolean;
  licenseType: string | null;
  codeowners: string[];
}

export async function checkGovernance(projectDir: string): Promise<GovernanceCheck> {
  const result: GovernanceCheck = {
    hasLicense: false,
    hasContributing: false,
    hasCodeowners: false,
    hasReadme: false,
    hasContext: false,
    hasChangelog: false,
    licenseType: null,
    codeowners: [],
  };

  const licenseFiles = ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING"];
  for (const f of licenseFiles) {
    const path = join(projectDir, f);
    if (pathExists(path)) {
      result.hasLicense = true;
      const content = (await Bun.file(path).text()).slice(0, 500).toLowerCase();
      if (content.includes("mit")) result.licenseType = "MIT";
      else if (content.includes("apache")) result.licenseType = "Apache-2.0";
      else if (content.includes("bsd")) result.licenseType = "BSD";
      else if (content.includes("gpl")) result.licenseType = "GPL";
      else result.licenseType = "Unknown";
      break;
    }
  }

  result.hasChangelog = pathExists(join(projectDir, "CHANGELOG.md"));
  result.hasContributing = pathExists(join(projectDir, "CONTRIBUTING.md"));

  const codeownersPaths = [
    join(projectDir, "CODEOWNERS"),
    join(projectDir, ".github", "CODEOWNERS"),
    join(projectDir, "docs", "CODEOWNERS"),
  ];
  for (const path of codeownersPaths) {
    if (pathExists(path)) {
      result.hasCodeowners = true;
      const lines = (await Bun.file(path).text()).split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          const match = trimmed.match(/@[\w-]+/g);
          if (match) result.codeowners.push(...match);
        }
      }
      break;
    }
  }

  result.hasReadme = pathExists(join(projectDir, "README.md"));
  result.hasContext = pathExists(join(projectDir, "CONTEXT.md"));

  return result;
}
