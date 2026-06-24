/**
 * workflow/semver-matcher.ts — Minimal semver ordering for workflow fix suggestions.
 */

/** Compare semver tuples; returns negative when a < b. */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .replace(/^[^0-9]*/, "")
      .split(/[.-]/)
      .map((part) => Number.parseInt(part, 10) || 0);
  const av = parse(a);
  const bv = parse(b);
  const len = Math.max(av.length, bv.length);
  for (let i = 0; i < len; i++) {
    const diff = (av[i] ?? 0) - (bv[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export const SemverMatcher = {
  order: compareSemver,
  latest(versions: string[]): string | null {
    if (versions.length === 0) return null;
    return [...versions].sort(compareSemver).at(-1) ?? null;
  },
};
