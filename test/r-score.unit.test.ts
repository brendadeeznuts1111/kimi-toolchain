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
});
