/**
 * transpiler-scan.ts — Lightweight TypeScript function/method scanner.
 *
 * Scans source files for exported function and method declarations without
 * requiring a full TypeScript AST parse. Used by kimi-heal's effect audit
 * to check method-level discipline rules (bare promises, domain purity).
 */

import { resolve } from "path";
import { readText } from "../lib/bun-io.ts";

/** A discovered effect method. */
export interface EffectMethod {
  /** Function or method name. */
  methodName: string;
  /** Absolute path to the source file. */
  sourceFile: string;
}

/**
 * Scan a glob pattern for exported function/method declarations.
 *
 * Recognises:
 *   - `export function foo`
 *   - `export async function foo`
 *   - `export const foo =`
 *   - `public foo(` / `private foo(` (class methods)
 *   - `static foo(`
 *
 * Returns absolute file paths. Results are deduplicated by (sourceFile, methodName).
 */
export function scanEffectMethods(pattern: string): EffectMethod[] {
  const results: EffectMethod[] = [];
  const seen = new Set<string>();
  const cwd = resolve(".");

  // Synchronous glob using Bun.Glob
  const glob = new Bun.Glob(pattern);

  // Collect matches synchronously
  const scanIter = glob.scanSync({ cwd, absolute: true, dot: true });
  for (const filePath of scanIter) {
    if (!filePath.endsWith(".ts")) continue;
    // Skip test files
    if (filePath.endsWith(".test.ts") || filePath.includes(".test/")) continue;

    let source: string;
    try {
      source = readText(filePath);
    } catch {
      continue;
    }
    if (!source) continue;

    const methods = extractMethodNames(source);
    for (const name of methods) {
      const key = `${filePath}::${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ methodName: name, sourceFile: filePath });
    }
  }

  return results;
}

/**
 * Extract exported function/method names from TypeScript source text.
 *
 * Regex-based for speed — avoids full TypeScript AST parse for simple
 * method-name discovery in audit runs.
 */
function extractMethodNames(source: string): string[] {
  const names: string[] = [];

  // export function foo / export async function foo
  const exportFuncRe = /export\s+(?:async\s+)?function\s+(\w+)\s*[<(]/gm;
  for (const m of source.matchAll(exportFuncRe)) {
    if (m[1]) names.push(m[1]);
  }

  // export const foo = (...) => / export const foo = async (...) =>
  const exportConstRe = /export\s+const\s+(\w+)\s*=\s*(?:async\s*)?\(/gm;
  for (const m of source.matchAll(exportConstRe)) {
    if (m[1]) names.push(m[1]);
  }

  // export const foo = function / export const foo = async function
  const exportConstFuncRe = /export\s+const\s+(\w+)\s*=\s*(?:async\s+)?function/gm;
  for (const m of source.matchAll(exportConstFuncRe)) {
    if (m[1]) names.push(m[1]);
  }

  // class method declarations: public/private/protected foo( / static foo(
  const classMethodRe = /(?:public|private|protected|static)\s+(?:async\s+)?(\w+)\s*\(/gm;
  for (const m of source.matchAll(classMethodRe)) {
    const name = m[1];
    // Skip common keywords that aren't method names
    if (name && !RESERVED.has(name)) names.push(name);
  }

  return names;
}

/** Keywords that match the method regex but aren't actual method names. */
const RESERVED = new Set([
  "if",
  "else",
  "for",
  "while",
  "switch",
  "return",
  "throw",
  "try",
  "catch",
  "finally",
  "new",
  "delete",
  "typeof",
  "instanceof",
  "in",
  "of",
  "async",
  "await",
  "yield",
  "function",
]);
