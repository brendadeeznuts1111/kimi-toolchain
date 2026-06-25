/**
 * Ported from oven-sh/bun test/cli/user-agent.test.ts @ pinned commit.
 *
 * @see https://github.com/oven-sh/bun/blob/1bd44dbe60ff766faadb41e71a8ca67de4c72a6f/test/cli/user-agent.test.ts
 */

import { describe, expect, test } from "bun:test";
import { join } from "path";
import { runUserAgentContractProbes } from "../src/lib/bun-cli-contract-probes.ts";
import { spawnCaptured, withTempDir, writeText } from "./helpers.ts";

function userAgentScript(expected: string | null): string {
  if (expected) {
    return `
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const userAgent = request.headers.get("User-Agent");
    if (userAgent === "${expected}") {
      process.exit(0);
    }
    process.exit(1);
  } });
try {
  await fetch(\`http://localhost:\${server.port}/test\`);
} catch {
  process.exit(1);
}
`;
  }
  return `
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const userAgent = request.headers.get("User-Agent");
    if (userAgent && userAgent.includes("Bun/")) {
      process.exit(0);
    }
    process.exit(1);
  } });
try {
  await fetch(\`http://localhost:\${server.port}/test\`);
} catch {
  process.exit(1);
}
`;
}

describe("bun-cli-user-agent contract probes", () => {
  test("runUserAgentContractProbes all pass on current Bun", async () => {
    const results = await runUserAgentContractProbes();
    const failed = results.filter((r) => !r.ok);
    expect(failed).toEqual([]);
  });
});

describe("bun-cli-user-agent", () => {
  test("custom user agent is sent in HTTP requests", async () => {
    await withTempDir("user-agent-custom-", async (dir) => {
      writeText(join(dir, "test.js"), userAgentScript("MyCustomUserAgent/1.0"));
      const cap = await spawnCaptured(
        [process.execPath, "--user-agent", "MyCustomUserAgent/1.0", "test.js"],
        { cwd: dir }
      );
      expect(cap.exitCode).toBe(0);
    });
  });

  test("default user agent is used when --user-agent is not specified", async () => {
    await withTempDir("user-agent-default-", async (dir) => {
      writeText(join(dir, "test.js"), userAgentScript(null));
      const cap = await spawnCaptured([process.execPath, "test.js"], { cwd: dir });
      expect(cap.exitCode).toBe(0);
    });
  });
});
