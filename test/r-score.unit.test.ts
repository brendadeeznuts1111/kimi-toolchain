import { describe, expect, test } from "bun:test";
import {
  breakdownIndicator,
  computeBreakdown,
  computeRScore,
  computeRScoreFromBreakdown,
  formatPct,
  formatPoints,
  grade,
  scorePct,
} from "../src/lib/r-score.ts";

const perfectInput = {
  hasLicense: true,
  hasContributing: true,
  hasCodeowners: true,
  hasReadme: true,
  hasContext: true,
  hasChangelog: true,
  coveragePercentage: 100,
  docsFresh: true,
  staleLockfile: false,
};

describe("r-score", () => {
  test("grade boundaries", () => {
    expect(grade(99, 110)).toBe("A");
    expect(grade(88, 110)).toBe("B");
    expect(grade(87.9, 110)).toBe("C");
    expect(grade(77, 110)).toBe("C");
    expect(grade(66, 110)).toBe("D");
    expect(grade(65, 110)).toBe("F");
  });

  test("scorePct and formatPct", () => {
    expect(scorePct(87.2, 110)).toBeCloseTo(79.27, 1);
    expect(formatPct(88, 110)).toBe("80.0%");
  });

  test("formatPoints shows one decimal for fractions", () => {
    expect(formatPoints(7)).toBe("7");
    expect(formatPoints(7.25)).toBe("7.3");
  });

  test("breakdownIndicator partial and full credit", () => {
    expect(breakdownIndicator(25, 25)).toBe("✓");
    expect(breakdownIndicator(7.2, 25)).toBe("~");
    expect(breakdownIndicator(0, 25)).toBe("✗");
  });

  test("computeBreakdown uses fractional testCoverage", () => {
    const breakdown = computeBreakdown({ ...perfectInput, coveragePercentage: 28.9 });
    expect(breakdown.testCoverage).toBeCloseTo(7.225, 2);
  });

  test("computeRScore reaches B with modest coverage", () => {
    const result = computeRScore({
      ...perfectInput,
      coveragePercentage: 32,
    });
    expect(result.grade).toBe("B");
    expect(result.total).toBeGreaterThanOrEqual(88);
  });

  test("perfect score is 105/110 grade A", () => {
    const result = computeRScoreFromBreakdown(computeBreakdown(perfectInput));
    expect(result.total).toBe(105);
    expect(result.max).toBe(110);
    expect(result.grade).toBe("A");
  });

  test("property: grade is monotonic with score", () => {
    // Generate 50 random scores and verify grade never decreases as score increases
    const scores: Array<{ score: number; grade: string }> = [];
    for (let i = 0; i < 50; i++) {
      const coverage = Math.random() * 100;
      const input = {
        hasLicense: Math.random() > 0.5,
        hasContributing: Math.random() > 0.5,
        hasCodeowners: Math.random() > 0.5,
        hasReadme: Math.random() > 0.5,
        hasContext: Math.random() > 0.5,
        hasChangelog: Math.random() > 0.5,
        coveragePercentage: coverage,
        docsFresh: Math.random() > 0.5,
        staleLockfile: Math.random() > 0.5,
      };
      const result = computeRScore(input);
      scores.push({ score: result.total, grade: result.grade });
    }
    scores.sort((a, b) => a.score - b.score);
    const gradeOrder = ["F", "D", "C", "B", "A"];
    let lastGradeIndex = -1;
    for (const s of scores) {
      const idx = gradeOrder.indexOf(s.grade);
      expect(idx).toBeGreaterThanOrEqual(lastGradeIndex);
      lastGradeIndex = idx;
    }
  });

  test("property: total is within [0, max] for all random inputs", () => {
    for (let i = 0; i < 100; i++) {
      const input = {
        hasLicense: Math.random() > 0.5,
        hasContributing: Math.random() > 0.5,
        hasCodeowners: Math.random() > 0.5,
        hasReadme: Math.random() > 0.5,
        hasContext: Math.random() > 0.5,
        hasChangelog: Math.random() > 0.5,
        coveragePercentage: Math.random() * 100,
        docsFresh: Math.random() > 0.5,
        staleLockfile: Math.random() > 0.5,
      };
      const result = computeRScore(input);
      expect(result.total).toBeGreaterThanOrEqual(0);
      expect(result.total).toBeLessThanOrEqual(result.max);
      expect(result.percentage).toBeGreaterThanOrEqual(0);
      expect(result.percentage).toBeLessThanOrEqual(100);
    }
  });

  test("property: breakdown sums to total", () => {
    for (let i = 0; i < 50; i++) {
      const input = {
        hasLicense: Math.random() > 0.5,
        hasContributing: Math.random() > 0.5,
        hasCodeowners: Math.random() > 0.5,
        hasReadme: Math.random() > 0.5,
        hasContext: Math.random() > 0.5,
        hasChangelog: Math.random() > 0.5,
        coveragePercentage: Math.random() * 100,
        docsFresh: Math.random() > 0.5,
        staleLockfile: Math.random() > 0.5,
      };
      const breakdown = computeBreakdown(input);
      const sum = Object.values(breakdown).reduce((s, v) => s + v, 0);
      const result = computeRScoreFromBreakdown(breakdown);
      expect(sum).toBeCloseTo(result.total, 5);
    }
  });
});
