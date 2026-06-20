/**
 * Bun `expectTypeOf` type-testing regression guard.
 *
 * expectTypeOf provides type-level assertions checked by tsc --noEmit.
 * The runtime calls are no-ops for matching types — they don't throw.
 *
 * @see https://bun.com/docs/test/writing-tests#type-testing
 */
import { expect, expectTypeOf, test } from "bun:test";

test("expectTypeOf basic matchers run without error", () => {
  // These are no-ops at runtime when types match
  expectTypeOf("hello").toEqualTypeOf<string>();
  expectTypeOf(42).toBeNumber();
  expectTypeOf("hello").toBeString();
  expectTypeOf([1, 2, 3]).items.toBeNumber();
});

test("expectTypeOf toBeFunction runs without error", () => {
  function greet(_name: string): string {
    return "hi";
  }
  expectTypeOf(greet).toBeFunction();
  expectTypeOf(greet).returns.toEqualTypeOf<string>();
});
