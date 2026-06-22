/**
 * autophagy-scan.ts — Lightweight source hygiene probes for dead code and env access.
 */

export interface AutophagyFinding {
  file: string;
  line: number;
  kind: "process-env" | "dead-branch";
  snippet: string;
}

function isTestPath(file: string): boolean {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(file) || file.includes("/test/");
}

/** Scan a single source file's text for hygiene issues. */
export function scanSourceText(file: string, text: string): AutophagyFinding[] {
  const findings: AutophagyFinding[] = [];
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNum = i + 1;

    if (!isTestPath(file) && /process\.env\b/.test(line)) {
      findings.push({ file, line: lineNum, kind: "process-env", snippet: line.trim() });
    }

    if (/if\s*\(\s*false\s*\)/.test(line)) {
      findings.push({ file, line: lineNum, kind: "dead-branch", snippet: line.trim() });
    }
  }

  return findings;
}
