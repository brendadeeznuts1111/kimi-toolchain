import { describe, expect, test } from "bun:test";
import {
  classifyPrCheck,
  isActionsBillingFailure,
  summarizePrChecks,
} from "../src/lib/github-pr-checks.ts";

describe("github-pr-checks", () => {
  test("detects Actions billing lockout messages", () => {
    expect(
      isActionsBillingFailure(
        "The job was not started because your account is locked due to a billing issue."
      )
    ).toBe(true);
    expect(isActionsBillingFailure("lint failed")).toBe(false);
  });

  test("ignores quality and governance Actions jobs in favor of local CI", () => {
    expect(classifyPrCheck({ name: "quality", conclusion: "FAILURE" }).disposition).toBe("ignored");
    expect(classifyPrCheck({ name: "governance", conclusion: "FAILURE" }).disposition).toBe(
      "ignored"
    );
  });

  test("treats Socket Security and CodeRabbit as informational", () => {
    expect(
      classifyPrCheck({ name: "Socket Security: Pull Request Alerts", conclusion: "SUCCESS" })
        .disposition
    ).toBe("informational");
    expect(classifyPrCheck({ name: "CodeRabbit", conclusion: "SUCCESS" }).disposition).toBe(
      "informational"
    );
  });

  test("summarizePrChecks passes when local CI passes and Actions quality/governance fail", () => {
    const report = summarizePrChecks(
      [
        { name: "quality", conclusion: "FAILURE" },
        { name: "governance", conclusion: "FAILURE" },
        { name: "CodeRabbit", conclusion: "SUCCESS" },
      ],
      { localCiPassing: true }
    );

    expect(report.requiredPassing).toBe(true);
    expect(report.blocking).toHaveLength(0);
    expect(report.ignored.map((check) => check.name)).toEqual(["quality", "governance"]);
    expect(report.message).toContain("Local CI passing");
  });

  test("summarizePrChecks skips local CI verdict when not run", () => {
    const report = summarizePrChecks([{ name: "quality", conclusion: "FAILURE" }], {
      localCiPassing: null,
    });

    expect(report.requiredPassing).toBe(true);
    expect(report.message).toContain("run: bun run ci:local");
  });

  test("summarizePrChecks fails when local CI fails", () => {
    const report = summarizePrChecks([{ name: "quality", conclusion: "FAILURE" }], {
      localCiPassing: false,
    });

    expect(report.requiredPassing).toBe(false);
    expect(report.message).toContain("Local CI failing");
  });
});
