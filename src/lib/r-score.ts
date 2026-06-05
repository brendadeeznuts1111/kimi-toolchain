/**
 * R-Score pure functions — grading and breakdown (no I/O).
 */

export const R_SCORE_WEIGHTS = {
  hasLicense: 10,
  hasContributing: 10,
  hasCodeowners: 10,
  hasReadme: 10,
  hasContext: 10,
  hasChangelog: 5,
  testCoverage: 25,
  docsFresh: 15,
  noStaleLockfile: 10,
} as const;

export type RScoreWeightKey = keyof typeof R_SCORE_WEIGHTS;

export interface RScoreBreakdownInput {
  hasLicense: boolean;
  hasContributing: boolean;
  hasCodeowners: boolean;
  hasReadme: boolean;
  hasContext: boolean;
  hasChangelog: boolean;
  coveragePercentage: number;
  docsFresh: boolean;
  staleLockfile: boolean;
}

export interface ComputedRScore {
  breakdown: Record<string, number>;
  total: number;
  max: number;
  grade: string;
  percentage: number;
}

export function scorePct(score: number, max: number): number {
  return max > 0 ? (score / max) * 100 : 0;
}

export function formatPct(score: number, max: number): string {
  return `${scorePct(score, max).toFixed(1)}%`;
}

export function formatPoints(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function grade(score: number, max: number): string {
  const pct = scorePct(score, max) / 100;
  if (pct >= 0.9) return "A";
  if (pct >= 0.8) return "B";
  if (pct >= 0.7) return "C";
  if (pct >= 0.6) return "D";
  return "F";
}

export function breakdownIndicator(value: number, weight: number): string {
  if (value >= weight - 0.05) return "✓";
  if (value > 0) return "~";
  return "✗";
}

export function computeBreakdown(input: RScoreBreakdownInput): Record<string, number> {
  const W = R_SCORE_WEIGHTS;
  return {
    hasLicense: input.hasLicense ? W.hasLicense : 0,
    hasContributing: input.hasContributing ? W.hasContributing : 0,
    hasCodeowners: input.hasCodeowners ? W.hasCodeowners : 0,
    hasReadme: input.hasReadme ? W.hasReadme : 0,
    hasContext: input.hasContext ? W.hasContext : 0,
    hasChangelog: input.hasChangelog ? 5 : 0,
    testCoverage: (input.coveragePercentage / 100) * W.testCoverage,
    docsFresh: input.docsFresh ? W.docsFresh : 0,
    noStaleLockfile: !input.staleLockfile ? W.noStaleLockfile : 0,
  };
}

export function computeRScoreFromBreakdown(breakdown: Record<string, number>): ComputedRScore {
  const total = Object.values(breakdown).reduce((s, v) => s + v, 0);
  const max = Object.values(R_SCORE_WEIGHTS).reduce((s, v) => s + v, 0) + 5;
  return {
    breakdown,
    total,
    max,
    grade: grade(total, max),
    percentage: scorePct(total, max),
  };
}

export function computeRScore(input: RScoreBreakdownInput): ComputedRScore {
  return computeRScoreFromBreakdown(computeBreakdown(input));
}
