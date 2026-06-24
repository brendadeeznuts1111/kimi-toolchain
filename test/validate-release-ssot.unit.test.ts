import { describe, expect, test } from "bun:test";
import { collectFailedBlogAudits } from "../scripts/validate-release-ssot.ts";
import type { ReleaseBlogAuditResult } from "../scripts/audit-release-blogs.ts";

describe("validate-release-ssot", () => {
  test("collectFailedBlogAudits flags failed results and non-empty drifts", () => {
    const results: ReleaseBlogAuditResult[] = [
      { version: "1.3.6", ok: true, blogUrl: "https://example.com", drifts: [] },
      {
        version: "1.3.7",
        ok: false,
        blogUrl: "https://example.com",
        drifts: [{ field: "hash", expected: "a", actual: "b", message: "hash mismatch" }],
      },
      {
        version: "1.3.5",
        ok: true,
        blogUrl: "https://example.com",
        drifts: [
          { field: "version", expected: "1.3.5", actual: "1.3.4", message: "version mismatch" },
        ],
      },
    ];

    const failed = collectFailedBlogAudits(results);
    expect(failed.map((entry) => entry.version)).toEqual(["1.3.7", "1.3.5"]);
  });
});
