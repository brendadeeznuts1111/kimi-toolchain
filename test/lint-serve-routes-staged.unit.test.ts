import { describe, expect, test } from "bun:test";
import { findManualDispatchAdditions } from "../scripts/lint-serve-routes-staged.ts";

describe("findManualDispatchAdditions", () => {
  test("flags new if (path === ...) additions", () => {
    const diff = [
      "+++ b/src/lib/herdr-dashboard/server/router.ts",
      "+  if (path === \"/api/new\") {",
    ].join("\n");
    expect(findManualDispatchAdditions(diff)).toHaveLength(1);
  });

  test("flags new if (path.startsWith(...)) additions", () => {
    const diff = [
      "+++ b/src/lib/herdr-dashboard/server/router.ts",
      "+  if (path.startsWith(\"/api/widgets/\")) {",
    ].join("\n");
    expect(findManualDispatchAdditions(diff)).toHaveLength(1);
  });

  test("ignores context and removed lines", () => {
    const diff = [
      "+++ b/src/lib/herdr-dashboard/server/router.ts",
      "@@ -1,1 +1,2 @@",
      "-  if (path === \"/old\") {",
      "   if (path === \"/kept\") {",
    ].join("\n");
    expect(findManualDispatchAdditions(diff)).toHaveLength(0);
  });

  test("flags else-if manual dispatch", () => {
    const diff = "+  } else if (path === \"/api/x\") {";
    expect(findManualDispatchAdditions(diff)).toHaveLength(1);
  });
});