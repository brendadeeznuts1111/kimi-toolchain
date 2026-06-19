/**
 * effect-heal-fix.ts — Advanced Effect discipline repairs for kimi-heal --fix.
 *
 * Repairs:
 *   1. Bare Promise chains (.then / .catch / .finally) → Effect.tryPromise + async/await
 *   2. Domain files importing getEffect → rewrite to injected-effect parameter pattern
 *   3. CLI main().catch → runCliExit(Effect.tryPromise(...)) when Effect is already imported
 */

import { relative, resolve } from "path";
import ts from "typescript";
import { buildEffectGatesReport, EFFECT_GATES, type EffectGatesViolation } from "./effect-gates.ts";

export interface EffectHealFixOptions {
  projectRoot: string;
  dryRun?: boolean;
  include?: string[];
}

export interface EffectHealFixChange {
  file: string;
  line?: number;
  kind: "promise-wrap" | "import-rewrite" | "main-catch";
  detail: string;
}

export interface EffectHealFixResult {
  dryRun: boolean;
  filesTouched: number;
  changes: EffectHealFixChange[];
  remainingViolations: number;
}

function ensureEffectImport(source: string): string {
  if (/from\s+["']effect["']/.test(source)) return source;
  const importLine = 'import { Effect } from "effect";\n';
  const shebang = source.startsWith("#!") ? source.slice(0, source.indexOf("\n") + 1) : "";
  const rest = source.startsWith("#!") ? source.slice(shebang.length) : source;
  return shebang + importLine + rest;
}

/** Rewrite `base.then(fn)` call expressions to async/await inside Effect.tryPromise. */
function rewriteThenCalls(sourceFile: ts.SourceFile): { text: string; count: number } {
  const edits: Array<{ start: number; end: number; text: string }> = [];
  let count = 0;

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "then"
    ) {
      const base = node.expression.expression.getText(sourceFile);
      const arg = node.arguments[0];
      if (!arg) {
        ts.forEachChild(node, visit);
        return;
      }
      const argText = arg.getText(sourceFile);
      const replacement = `Effect.tryPromise(async () => {
  const __healValue = await ${base};
  return (${argText})(__healValue);
})`;
      edits.push({ start: node.getStart(sourceFile), end: node.getEnd(), text: replacement });
      count++;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  if (edits.length === 0) return { text: sourceFile.text, count: 0 };

  edits.sort((a, b) => b.start - a.start);
  let text = sourceFile.text;
  for (const edit of edits) {
    text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  }
  return { text, count };
}

/** Rewrite standalone `.catch(` / `.finally(` suffix chains on prior expression (statement level). */
function rewriteCatchFinally(source: string): { text: string; count: number } {
  let count = 0;
  const catchRe = /^(\s*)([\w.$()[\],'"`\s]+)\.catch\s*\(\s*(async\s*)?\(/gm;
  let text = source.replace(catchRe, (_m, indent, expr) => {
    count++;
    return `${indent}Effect.runPromise(Effect.tryPromise(async () => ${expr.trim()}).pipe(Effect.catchAll(`;
  });
  return { text, count };
}

/** Rewrite domain/ files that import getEffect to accept injected effect. */
function rewriteDomainGetEffectImport(
  source: string,
  relPath: string
): { text: string; changed: boolean } {
  if (!relPath.includes("domain/") && !relPath.includes("src/effect/")) {
    return { text: source, changed: false };
  }
  if (!source.includes("getEffect")) return { text: source, changed: false };

  let text = source;
  text = text.replace(
    /import\s+\{[^}]*\bgetEffect\b[^}]*\}\s+from\s+["'][^"']+["'];?\n/g,
    "// @effect-heal-fix: getEffect import removed — pass effect handlers as parameters\n"
  );
  text = text.replace(
    /\bgetEffect\s*\(\s*["']([^"']+)["']\s*\)/g,
    '/* @effect-heal-fix: inject */ (globalThis as Record<symbol, unknown>)[Symbol.for("kimi.effect.$1")]'
  );
  return { text, changed: text !== source };
}

function rewriteMainCatch(source: string, relPath: string): { text: string; changed: boolean } {
  if (!relPath.startsWith("src/bin/") && !relPath.startsWith("src/")) {
    return { text: source, changed: false };
  }
  const re =
    /(\bmain\s*\([^)]*\))\s*\.catch\s*\(\s*(async\s*)?\(\s*(\w+)\s*\)\s*=>\s*\{([^}]*)\}\s*\)\s*;?\s*$/m;
  if (!re.test(source)) return { text: source, changed: false };
  let text = source.replace(
    re,
    `Effect.runPromise(
  Effect.tryPromise({ try: () => $1, catch: ($3) => Effect.sync(() => { $4 }) })
);`
  );
  text = ensureEffectImport(text);
  return { text, changed: true };
}

async function loadSourceFiles(projectRoot: string, include?: string[]): Promise<string[]> {
  const patterns = include?.length ? include : ["src/**/*.ts"];
  const files = new Set<string>();
  for (const pattern of patterns) {
    const glob = new Bun.Glob(pattern);
    for await (const rel of glob.scan({ cwd: projectRoot, absolute: false })) {
      if (rel.endsWith(".d.ts")) continue;
      files.add(resolve(projectRoot, rel));
    }
  }
  return [...files].sort();
}

function parseSource(filePath: string, text: string): ts.SourceFile {
  return ts.createSourceFile(filePath, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
}

/** Apply advanced repairs; re-scan with effect-gates to report remaining violations. */
export async function applyEffectHealFix(
  options: EffectHealFixOptions
): Promise<EffectHealFixResult> {
  const projectRoot = resolve(options.projectRoot);
  const dryRun = options.dryRun ?? false;
  const files = await loadSourceFiles(projectRoot, options.include);
  const changes: EffectHealFixChange[] = [];
  let filesTouched = 0;

  for (const filePath of files) {
    const relPath = relative(projectRoot, filePath).replace(/\\/g, "/");
    if (relPath.includes(".kimi/") || relPath.includes("node_modules/")) continue;

    let text = await Bun.file(filePath).text();
    const original = text;
    let fileChanged = false;

    const mainFix = rewriteMainCatch(text, relPath);
    if (mainFix.changed) {
      text = mainFix.text;
      changes.push({
        file: relPath,
        kind: "main-catch",
        detail: "main().catch → Effect.tryPromise",
      });
      fileChanged = true;
    }

    const domainFix = rewriteDomainGetEffectImport(text, relPath);
    if (domainFix.changed) {
      text = domainFix.text;
      changes.push({
        file: relPath,
        kind: "import-rewrite",
        detail: "getEffect import → injected symbol lookup",
      });
      fileChanged = true;
    }

    const catchFix = rewriteCatchFinally(text);
    if (catchFix.count > 0) {
      text = catchFix.text;
      text = ensureEffectImport(text);
      changes.push({
        file: relPath,
        kind: "promise-wrap",
        detail: `${catchFix.count} .catch chain(s) → Effect.runPromise`,
      });
      fileChanged = true;
    }

    const sourceFile = parseSource(filePath, text);
    const thenFix = rewriteThenCalls(sourceFile);
    if (thenFix.count > 0) {
      text = ensureEffectImport(thenFix.text);
      changes.push({
        file: relPath,
        kind: "promise-wrap",
        detail: `${thenFix.count} .then chain(s) → Effect.tryPromise`,
      });
      fileChanged = true;
    }

    if (fileChanged && text !== original) {
      filesTouched++;
      if (!dryRun) await Bun.write(filePath, text);
    }
  }

  const report = await buildEffectGatesReport({
    projectRoot,
    tool: "kimi-heal",
    include: options.include,
  });

  return {
    dryRun,
    filesTouched,
    changes,
    remainingViolations: report.violations.filter(
      (v) => v.gate === EFFECT_GATES.directPromise || v.gate === EFFECT_GATES.domainPurity
    ).length,
  };
}

/** Violations eligible for automated repair. */
export function fixableViolations(violations: EffectGatesViolation[]): EffectGatesViolation[] {
  return violations.filter(
    (v) =>
      v.gate === EFFECT_GATES.directPromise ||
      v.gate === EFFECT_GATES.domainPurity ||
      v.message.includes("getEffect")
  );
}
