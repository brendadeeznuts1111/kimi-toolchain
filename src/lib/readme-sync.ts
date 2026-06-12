/**
 * README ↔ package.json script drift detection and auto-patch.
 */

import { existsSync } from "fs";
import { join } from "path";

export interface DocDrift {
  readmeScripts: string[];
  pkgScripts: string[];
  missingFromReadme: string[];
  extraInReadme: string[];
  fresh: boolean;
}

export async function checkDocDrift(projectDir: string): Promise<DocDrift> {
  const drift: DocDrift = {
    readmeScripts: [],
    pkgScripts: [],
    missingFromReadme: [],
    extraInReadme: [],
    fresh: true,
  };

  const readmePath = join(projectDir, "README.md");
  const pkgPath = join(projectDir, "package.json");

  if (!existsSync(readmePath) || !existsSync(pkgPath)) {
    drift.fresh = false;
    return drift;
  }

  const readme = await Bun.file(readmePath).text();
  const pkg = (await Bun.file(pkgPath).json()) as { scripts?: Record<string, string> };
  const scripts = pkg.scripts || {};

  const scriptPattern = /(?:bun run |npm run |yarn )([\w:-]+)/g;
  const codeBlockPattern = /```[\s\S]*?```/g;

  let match;
  while ((match = scriptPattern.exec(readme)) !== null) {
    drift.readmeScripts.push(match[1]);
  }

  const codeBlocks = readme.match(codeBlockPattern) || [];
  for (const block of codeBlocks) {
    for (const scriptName of Object.keys(scripts)) {
      if (block.includes(scriptName) && !drift.readmeScripts.includes(scriptName)) {
        drift.readmeScripts.push(scriptName);
      }
    }
  }

  drift.pkgScripts = Object.keys(scripts);
  drift.missingFromReadme = drift.pkgScripts.filter((s) => !drift.readmeScripts.includes(s));
  drift.extraInReadme = drift.readmeScripts.filter((s) => !drift.pkgScripts.includes(s));
  drift.fresh = drift.missingFromReadme.length === 0 && drift.extraInReadme.length === 0;

  return drift;
}

/** Append missing package.json scripts to the README Project Scripts table. */
export async function patchReadmeScripts(projectDir: string): Promise<number> {
  const drift = await checkDocDrift(projectDir);
  if (drift.missingFromReadme.length === 0) return 0;

  const readmePath = join(projectDir, "README.md");
  let readme = await Bun.file(readmePath).text();

  const rows = drift.missingFromReadme
    .map((s) => `| \`bun run ${s}\` | (synced from package.json) |`)
    .join("\n");

  const sectionEnd = readme.search(/\n### /);
  if (sectionEnd > 0) {
    readme = readme.slice(0, sectionEnd) + "\n" + rows + readme.slice(sectionEnd);
  } else {
    readme += "\n" + rows + "\n";
  }

  await Bun.write(readmePath, readme);
  return drift.missingFromReadme.length;
}

/** CLI entry — returns process exit code (0 = success). */
export async function runReadmeSyncCli(args: string[]): Promise<number> {
  try {
    const fix = args.includes("--fix");
    const projectDir = args.find((a) => !a.startsWith("-")) || Bun.cwd;

    if (fix) {
      const patched = await patchReadmeScripts(projectDir);
      if (patched > 0) {
        console.log(`Patched README.md with ${patched} script(s)`);
      } else {
        console.log("README scripts already in sync");
      }
      return 0;
    }

    const drift = await checkDocDrift(projectDir);
    if (drift.fresh) {
      console.log("README scripts: in sync");
      return 0;
    }
    if (drift.missingFromReadme.length > 0) {
      console.log(`Missing from README: ${drift.missingFromReadme.join(", ")}`);
    }
    if (drift.extraInReadme.length > 0) {
      console.log(`Extra in README: ${drift.extraInReadme.join(", ")}`);
    }
    return 1;
  } catch (err) {
    console.error("readme-sync failed:", (err as Error).message);
    return 1;
  }
}

if (import.meta.main) {
  runReadmeSyncCli(Bun.argv.slice(2)).then((code) => {
    if (code !== 0) process.exit(code);
  });
}
