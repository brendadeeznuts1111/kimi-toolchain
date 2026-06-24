/**
 * Bun executable portability probes — glibc floor (Linux) and PE import allowlist (Windows).
 *
 * Mirrors oven-sh/bun linker compatibility tests; used by kimi-doctor and CI gates.
 */

/** glibc floor for RHEL/CentOS 7 / Amazon Linux 1 compatibility. */
export const GLIBC_FLOOR = [2, 17, 0] as const;

/**
 * Compare glibc version tuples (2.2.5, 2.17) — not semver.
 * Returns true when `v` is strictly above {@link GLIBC_FLOOR}.
 */
export function glibcVersionAboveFloor(v: string): boolean {
  const parts = v.split(".").map(Number);
  for (let i = 0; i < GLIBC_FLOOR.length; i++) {
    const a = parts[i] ?? 0;
    const b = GLIBC_FLOOR[i];
    if (a !== b) return a > b;
  }
  return false;
}

export interface GlibcSymbolViolation {
  symbol: string;
  glibcVersion: string;
}

/** Parse `objdump -T` GLIBC_* lines and return symbols above the floor. */
export function parseGlibcSymbolViolations(objdumpOutput: string): GlibcSymbolViolation[] {
  const errors: GlibcSymbolViolation[] = [];
  for (const line of objdumpOutput.split("\n")) {
    const match = line.match(/\(GLIBC_(\d+(?:\.\d+)+)\)\s/);
    if (match?.[1] && glibcVersionAboveFloor(match[1])) {
      errors.push({
        symbol: line.slice(line.lastIndexOf(")") + 1).trim(),
        glibcVersion: match[1],
      });
    }
  }
  return errors;
}

/** Return `ldd` lines that reference libatomic.so. */
export function parseLibatomicLines(lddOutput: string): string[] {
  return lddOutput.split("\n").filter((line) => line.includes("libatomic"));
}

export type PeImportKind = "static" | "delay";

export interface PeImport {
  dll: string;
  kind: PeImportKind;
}

/** Allowlisted Windows system DLLs (static or delay-load). */
export const ALLOWED_DLL_IMPORTS = new Set([
  "advapi32.dll",
  "api-ms-win-core-synch-l1-2-0.dll",
  "bcrypt.dll",
  "bcryptprimitives.dll",
  "crypt32.dll",
  "dbghelp.dll",
  "iphlpapi.dll",
  "kernel32.dll",
  "ntdll.dll",
  "ole32.dll",
  "oleaut32.dll",
  "shell32.dll",
  "user32.dll",
  "userenv.dll",
  "winmm.dll",
  "ws2_32.dll",
  "wsock32.dll",
]);

/** Delay-load only — hard import would break without VC++ redist. */
export const ALLOWED_DELAY_ONLY = new Set(["vcruntime140_1.dll"]);

function pushPeImport(imports: PeImport[], kind: PeImportKind, line: string): PeImportKind | null {
  const inline = line.match(/Name:\s*(\S+)/);
  if (inline) {
    imports.push({ dll: inline[1], kind });
    return null;
  }
  return kind;
}

/** Parse `llvm-readobj --coff-imports` output into static + delay imports. */
export function parsePeImports(readobjOutput: string): PeImport[] {
  const imports: PeImport[] = [];
  let currentKind: PeImportKind | null = null;
  for (const line of readobjOutput.split("\n")) {
    if (/^Import\s*\{/.test(line)) {
      currentKind = pushPeImport(imports, "static", line);
    } else if (/^DelayImport\s*\{/.test(line)) {
      currentKind = pushPeImport(imports, "delay", line);
    } else if (currentKind) {
      const m = line.match(/^\s*Name:\s*(\S+)/);
      if (m) {
        imports.push({ dll: m[1], kind: currentKind });
        currentKind = null;
      }
    }
  }
  return imports;
}

/** Filter imports that violate the allowlist. */
export function peImportViolations(imports: PeImport[]): PeImport[] {
  return imports.filter(({ dll, kind }) => {
    const lower = dll.toLowerCase();
    if (ALLOWED_DLL_IMPORTS.has(lower)) return false;
    if (ALLOWED_DELAY_ONLY.has(lower) && kind === "delay") return false;
    return true;
  });
}

/** TablePrinter error report — depth 0 matches console.table cell formatting. */
export function formatPortabilityViolationTable(
  rows: ReadonlyArray<object>,
  opts: { colors?: boolean } = {}
): string {
  if (rows.length === 0) return "";
  const tableOpts = {
    depth: 0,
    colors: opts.colors ?? true,
  } satisfies Bun.BunInspectOptions;
  return Bun.inspect.table(rows as Record<string, unknown>[], tableOpts);
}
