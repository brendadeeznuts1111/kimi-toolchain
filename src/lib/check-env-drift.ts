/**
 * check-env-drift.ts — Pure helpers for detecting drift between .env.example
 * (committed template) and the local gitignored .env file.
 *
 * @see scripts/check-env-drift.ts for the CLI wrapper
 * @see https://bun.com/docs/runtime/environment-variables
 */

export interface DriftResult {
  /** Keys present in .env.example but missing from .env. */
  exampleOnly: string[];
  /** Keys present in .env but missing from .env.example. */
  localOnly: string[];
  /** Total keys defined in .env.example. */
  exampleTotal: number;
  /** Total keys defined in .env. */
  localTotal: number;
}

/** Extract KEY names from a dotenv-style text block. */
export function parseEnvKeys(text: string): Set<string> {
  const keys = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (key) keys.add(key);
  }
  return keys;
}

/** Compare two key sets and report drift. */
export function computeDrift(example: Set<string>, local: Set<string>): DriftResult {
  const exampleOnly: string[] = [];
  const localOnly: string[] = [];

  for (const key of example) {
    if (!local.has(key)) exampleOnly.push(key);
  }
  for (const key of local) {
    if (!example.has(key)) localOnly.push(key);
  }

  return {
    exampleOnly: exampleOnly.sort(),
    localOnly: localOnly.sort(),
    exampleTotal: example.size,
    localTotal: local.size,
  };
}

/**
 * Build an updated .env text that appends missing keys from .env.example,
 * preserving their leading comment blocks for context.
 */
export function applyFix(result: DriftResult, exampleText: string, localText: string): string {
  if (result.exampleOnly.length === 0) return localText;

  const exampleLines = exampleText.split(/\r?\n/);
  const blocks: string[] = [];
  let currentBlock: string[] = [];

  function flushBlock() {
    if (currentBlock.length === 0) return;
    const keyLine = currentBlock.find((l) => {
      const trimmed = l.trim();
      return !trimmed.startsWith("#") && trimmed.includes("=");
    });
    if (!keyLine) {
      currentBlock = [];
      return;
    }
    const key = keyLine.slice(0, keyLine.indexOf("=")).trim();
    if (result.exampleOnly.includes(key)) {
      blocks.push(currentBlock.join("\n"));
    }
    currentBlock = [];
  }

  for (const line of exampleLines) {
    if (line.trim() === "" || line.trim().startsWith("#")) {
      currentBlock.push(line);
    } else if (line.includes("=")) {
      currentBlock.push(line);
      flushBlock();
    } else {
      currentBlock = [];
    }
  }
  flushBlock();

  const separator = localText.endsWith("\n") ? "" : "\n";
  const append =
    "\n# -- Synchronized from .env.example by check-env-drift.ts --fix --\n" + blocks.join("\n\n");
  return localText + separator + append + "\n";
}

/** Human-readable summary of a drift result. */
export function formatDrift(result: DriftResult): string {
  const lines: string[] = [];
  lines.push("=== .env drift check ===");
  lines.push(`.env.example keys: ${result.exampleTotal}`);
  lines.push(`.env keys:         ${result.localTotal}`);

  if (result.exampleOnly.length > 0) {
    lines.push("");
    lines.push("Missing from .env (add from .env.example):");
    for (const key of result.exampleOnly) {
      lines.push(`  - ${key}`);
    }
  }

  if (result.localOnly.length > 0) {
    lines.push("");
    lines.push("Local-only in .env (not in .env.example):");
    for (const key of result.localOnly) {
      lines.push(`  - ${key}`);
    }
  }

  if (result.exampleOnly.length === 0 && result.localOnly.length === 0) {
    lines.push("✓ .env is in sync with .env.example");
  } else {
    lines.push("");
    lines.push("Run `bun scripts/check-env-drift.ts --fix` to append missing keys.");
  }

  return lines.join("\n");
}
