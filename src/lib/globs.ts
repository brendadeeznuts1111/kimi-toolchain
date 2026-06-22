/**
 * Pre-compiled Bun Glob patterns for doctor gates and CI scripts.
 *
 * @see https://bun.com/docs/runtime/glob
 */
import { Glob } from "bun";
import { join, resolve } from "path";
import {
  defaultGlobScanCachePath,
  globScanSentinels,
  loadGlobScanCache,
  saveGlobScanCache,
  sentinelsMatch,
} from "./glob-scan-cache.ts";

export interface GlobScanOptions {
  cwd?: string;
  dot?: boolean;
  absolute?: boolean;
  followSymlinks?: boolean;
  throwErrorOnBrokenSymlink?: boolean;
  onlyFiles?: boolean;
}

export interface SourceScanOptions {
  includeScripts?: boolean;
  includeExamples?: boolean;
  useScanCache?: boolean;
  globCachePath?: string;
}

export const SOURCE_SCAN_EXCLUDE = [
  "**/*.test.*",
  "**/*.spec.*",
  "**/node_modules/**",
  "**/dist/**",
  "**/.git/**",
] as const;

export const IMAGE_SCAN_EXCLUDE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.git/**",
  "test/fixtures/**",
] as const;

export const GLOB_PATTERNS = {
  srcTsAll: "src/**/*.{ts,tsx}",
  srcAndScriptsTsAll: "{src,scripts}/**/*.{ts,tsx}",
  srcScriptsAndExamplesTsAll: "{src,scripts,examples}/**/*.{ts,tsx}",
  binTs: "src/bin/*.ts",
  scriptsTs: "scripts/*.{ts,tsx}",
  testTs: "**/*.test.{ts,tsx}",
  templatePkg: "*/package.json",
  scaffoldBunfig: "templates/scaffold/bunfig.toml",
  templateBunfig: "templates/bun-create/*/bunfig.toml",
  secretsRegistry: "src/lib/secrets/_registry.ts",
  dotFiles: ".*",
  herdrSecretKey: "com.herdr.*/*",
  imagesAll: "**/*.{png,jpg,jpeg,webp,heic,avif,gif,bmp,ico}",
} as const;

export const GLOBS = {
  srcTsAll: new Glob(GLOB_PATTERNS.srcTsAll),
  srcAndScriptsTsAll: new Glob(GLOB_PATTERNS.srcAndScriptsTsAll),
  srcScriptsAndExamplesTsAll: new Glob(GLOB_PATTERNS.srcScriptsAndExamplesTsAll),
  binTs: new Glob(GLOB_PATTERNS.binTs),
  binTsFromRoot: new Glob(GLOB_PATTERNS.binTs),
  scriptsTs: new Glob(GLOB_PATTERNS.scriptsTs),
  testTs: new Glob(GLOB_PATTERNS.testTs),
  testTsAll: new Glob(GLOB_PATTERNS.testTs),
  templatePkg: new Glob(GLOB_PATTERNS.templatePkg),
  scaffoldBunfig: new Glob(GLOB_PATTERNS.scaffoldBunfig),
  templateBunfig: new Glob(GLOB_PATTERNS.templateBunfig),
  secretsRegistry: new Glob(GLOB_PATTERNS.secretsRegistry),
  dotFiles: new Glob(GLOB_PATTERNS.dotFiles),
  herdrSecretKey: new Glob(GLOB_PATTERNS.herdrSecretKey),
  imagesAll: new Glob(GLOB_PATTERNS.imagesAll),
} as const;

export function repoRoot(root = "."): string {
  return resolve(root);
}

export function bunCreateDir(root = "."): string {
  return join(repoRoot(root), "templates", "bun-create");
}

export function absoluteScanOpts(cwd: string): GlobScanOptions {
  return { cwd, onlyFiles: true, absolute: true };
}

export function isHerdrSecretKey(key: string): boolean {
  return GLOBS.herdrSecretKey.match(key);
}

export function isTestFile(path: string): boolean {
  return GLOBS.testTs.match(path);
}

export function sourceScanPatterns(options: {
  includeScripts?: boolean;
  includeExamples?: boolean;
}): readonly string[] {
  if (options.includeExamples) {
    return [GLOB_PATTERNS.srcScriptsAndExamplesTsAll];
  }
  return options.includeScripts ? [GLOB_PATTERNS.srcAndScriptsTsAll] : [GLOB_PATTERNS.srcTsAll];
}

function toAbsolutePaths(cwd: string, paths: string[]): string[] {
  return paths.map((file) => (file.startsWith("/") ? file : join(cwd, file)));
}

function compileExcludes(exclude: readonly string[]): Glob[] {
  return exclude.map((pattern) => new Glob(pattern));
}

function isExcluded(rel: string, excludeGlobs: Glob[]): boolean {
  return excludeGlobs.some((glob) => glob.match(rel));
}

function globScanSync(
  patterns: readonly string[],
  cwd: string,
  exclude: readonly string[]
): string[] {
  const excludeGlobs = compileExcludes(exclude);
  const seen = new Set<string>();
  for (const pattern of patterns) {
    const glob = new Glob(pattern);
    for (const rel of glob.scanSync({ cwd, onlyFiles: true })) {
      if (isExcluded(rel, excludeGlobs)) continue;
      seen.add(rel);
    }
  }
  return [...seen].sort();
}

async function* globScanAsync(
  patterns: readonly string[],
  cwd: string,
  exclude: readonly string[]
): AsyncGenerator<string> {
  const excludeGlobs = compileExcludes(exclude);
  for (const pattern of patterns) {
    const glob = new Glob(pattern);
    for await (const rel of glob.scan({ cwd, onlyFiles: true })) {
      if (isExcluded(rel, excludeGlobs)) continue;
      yield rel;
    }
  }
}

async function resolveRelativeScanPaths(
  cwd: string,
  patterns: readonly string[],
  options?: SourceScanOptions
): Promise<{ files: string[]; fromScanCache: boolean }> {
  const exclude = SOURCE_SCAN_EXCLUDE;
  const useScanCache = options?.useScanCache ?? true;
  const cachePath = options?.globCachePath ?? defaultGlobScanCachePath(cwd);
  const sentinels = globScanSentinels(cwd);

  if (useScanCache) {
    const cached = await loadGlobScanCache(cachePath, patterns, exclude);
    if (cached && sentinelsMatch(cached.sentinels, sentinels)) {
      return { files: [...cached.files], fromScanCache: true };
    }
  }

  const files = globScanSync(patterns, cwd, exclude);
  if (useScanCache) {
    await saveGlobScanCache(cachePath, { sentinels, patterns, exclude, files });
  }
  return { files, fromScanCache: false };
}

export function scanSourceFilesFsSync(
  root = ".",
  options?: Pick<SourceScanOptions, "includeScripts" | "includeExamples">
): string[] {
  const cwd = repoRoot(root);
  const patterns = sourceScanPatterns({
    includeScripts: options?.includeScripts ?? false,
    includeExamples: options?.includeExamples ?? false,
  });
  const files = globScanSync(patterns, cwd, SOURCE_SCAN_EXCLUDE);
  return toAbsolutePaths(cwd, files).sort();
}

export async function scanSourceFilesFs(
  root = ".",
  options?: SourceScanOptions
): Promise<{ files: string[]; fromScanCache: boolean }> {
  const cwd = repoRoot(root);
  const patterns = sourceScanPatterns({
    includeScripts: options?.includeScripts ?? false,
    includeExamples: options?.includeExamples ?? false,
  });
  const { files, fromScanCache } = await resolveRelativeScanPaths(cwd, patterns, options);
  return { files: toAbsolutePaths(cwd, files), fromScanCache };
}

export async function* scanSourceFilesLazy(
  root = ".",
  options?: SourceScanOptions
): AsyncGenerator<string> {
  const cwd = repoRoot(root);
  const patterns = sourceScanPatterns({
    includeScripts: options?.includeScripts ?? false,
    includeExamples: options?.includeExamples ?? false,
  });
  for await (const rel of globScanAsync(patterns, cwd, SOURCE_SCAN_EXCLUDE)) {
    yield rel.startsWith("/") ? rel : join(cwd, rel);
  }
}

export function scanBinTsSync(root = "."): string[] {
  return [...GLOBS.binTs.scanSync(absoluteScanOpts(repoRoot(root)))].sort();
}

export function scanTemplatePkgsSync(root = "."): string[] {
  return [...GLOBS.templatePkg.scanSync(absoluteScanOpts(bunCreateDir(root)))].sort();
}

export function scanDotFilesSync(dir: string): string[] {
  return [...GLOBS.dotFiles.scanSync({ ...absoluteScanOpts(dir), dot: true })].sort();
}

export function scanImageFilesSync(root = "."): string[] {
  const cwd = repoRoot(root);
  const files = globScanSync([GLOB_PATTERNS.imagesAll], cwd, IMAGE_SCAN_EXCLUDE);
  return toAbsolutePaths(cwd, files).sort();
}

export function scanSourceFilesSync(
  root = ".",
  options?: Pick<SourceScanOptions, "includeScripts" | "includeExamples">
): string[] {
  return scanSourceFilesFsSync(root, options);
}

export async function* scanSourceFiles(
  root = ".",
  options?: SourceScanOptions
): AsyncGenerator<string> {
  yield* scanSourceFilesLazy(root, options);
}
