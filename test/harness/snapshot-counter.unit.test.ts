/**
 * Snapshot counter regression guardrail.
 *
 * Bun v1.3.12 had a bug where toMatchSnapshot() counter was not reset between
 * --rerun-each / --retry iterations, causing "Snapshot creation is disabled" in CI.
 * Fixed in v1.3.13 (@chrislloyd).
 *
 * This test verifies the fix by asserting that snapshot-based assertions
 * produce consistent results across multiple iterations.
 *
 * Run with: bun test --rerun-each=3 test/harness/snapshot-counter.unit.test.ts
 */
import { describe, expect, test } from "bun:test";

describe("snapshot-counter", () => {
  test("toMatchSnapshot produces consistent output across iterations", () => {
    // If the counter isn't reset, this would look for "test name 2" on the
    // second iteration and fail with "Snapshot creation is disabled" in CI.
    expect({ key: "snapshot-counter-regression-value", value: 42 }).toMatchSnapshot();
  });

  test("inline snapshot matching is stable", () => {
    expect("hello snapshot").toMatchSnapshot();
  });

  test("complex object snapshot is stable", () => {
    expect({
      id: "regression-test",
      items: [1, 2, 3],
      nested: { a: true, b: false },
    }).toMatchSnapshot();
  });
});
