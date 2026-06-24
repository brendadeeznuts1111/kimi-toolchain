import { describe, expect, test } from "bun:test";
import { auditReleaseBlog } from "../scripts/audit-release-blogs.ts";
import { BUN_RELEASE_HISTORY } from "../src/lib/bun-release-registry.ts";

describe("audit-release-blogs", () => {
  test("auditReleaseBlog delegates to verifyReleaseMeta for a registry record", () => {
    const record = BUN_RELEASE_HISTORY["1.3.6"];
    const md = `---\ntitle: Bun v${record.version}\ndate: 2026-01-13\n---\n\n<!-- https://github.com/oven-sh/bun/commit/${record.hash} -->\n`;
    expect(auditReleaseBlog(md, record)).toHaveLength(0);
  });
});
