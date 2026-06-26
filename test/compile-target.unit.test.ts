import { describe, expect, test } from "bun:test";
import {
  buildCompileCliArgs,
  compileBinary,
  parseVersion,
  probeCompileCapabilities,
  runCompileGate,
} from "../src/lib/compile-target.ts";
import { readableStreamToText } from "../src/lib/bun-utils.ts";
import { withTempDir, writeText } from "../test/helpers.ts";

describe("compile-target", () => {
  // ── parseVersion ──────────────────────────────────────────────────

  test("parseVersion parses standard Bun version", () => {
    expect(parseVersion("1.4.0")).toEqual({ major: 1, minor: 4, patch: 0 });
  });

  test("parseVersion parses canary version", () => {
    const parsed = parseVersion("1.4.0-canary.1+dcc34a824");
    expect(parsed).not.toBeNull();
    expect(parsed!.major).toBe(1);
    expect(parsed!.minor).toBe(4);
    expect(parsed!.patch).toBe(0);
  });

  test("parseVersion returns null for garbage", () => {
    expect(parseVersion("not-a-version")).toBeNull();
    expect(parseVersion("")).toBeNull();
    expect(parseVersion("v1.2.3")).toBeNull();
  });

  test("parseVersion handles multi-digit versions", () => {
    expect(parseVersion("10.20.300")).toEqual({ major: 10, minor: 20, patch: 300 });
  });

  // ── probeCompileCapabilities ──────────────────────────────────────

  test("probeCompileCapabilities returns all capability flags", async () => {
    const caps = await probeCompileCapabilities();
    expect(caps.bunVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(caps.bunRevision).toBeTruthy();
    expect(typeof caps.esmBytecode).toBe("boolean");
    expect(typeof caps.compile).toBe("boolean");
    expect(typeof caps.bytecode).toBe("boolean");
    expect(typeof caps.cpuProfInterval).toBe("boolean");
    expect(typeof caps.cpuProfMd).toBe("boolean");
    expect(typeof caps.heapProf).toBe("boolean");
    expect(typeof caps.heapProfMd).toBe("boolean");
    expect(["esm", "cjs"]).toContain(caps.recommendedFormat);
  });

  test("probeCompileCapabilities is cached on second call", async () => {
    const caps1 = await probeCompileCapabilities();
    const caps2 = await probeCompileCapabilities();
    expect(caps1).toBe(caps2); // same object reference
  });

  test("probeCompileCapabilities on Bun 1.4.0 has esmBytecode", async () => {
    const caps = await probeCompileCapabilities();
    // Bun 1.4.0 >> 1.3.9, so ESM + bytecode should be supported
    if (caps.bunVersion.startsWith("1.")) {
      const major = parseInt(caps.bunVersion.split(".")[0] ?? "", 10);
      const minor = parseInt(caps.bunVersion.split(".")[1] ?? "", 10);
      if (major > 1 || (major === 1 && minor >= 4)) {
        expect(caps.esmBytecode).toBe(true);
      }
    }
  });

  test("buildCompileCliArgs adds --compile-executable-path when set", () => {
    const args = buildCompileCliArgs(
      {
        entryPoint: "./app.ts",
        outfile: "./out",
        executablePath: "/opt/bun-linux-x64",
      },
      "esm"
    );
    expect(args).toContain("--compile-executable-path");
    expect(args).toContain("/opt/bun-linux-x64");
  });

  // ── runCompileGate ────────────────────────────────────────────────

  test("runCompileGate smoke test passes on Bun 1.4.0", async () => {
    const gate = await runCompileGate();
    expect(gate.status).toBe("ok");
    expect(gate.capabilities.esmBytecode).toBe(true);
    expect(gate.messages.length).toBeGreaterThan(0);
    // Should have a smoke test result message
    const smokeMsg = gate.messages.find((m) => m.includes("Smoke test"));
    expect(smokeMsg).toBeTruthy();
  });

  test("runCompileGate cleans up temp files", async () => {
    // Run twice — second run should not fail from stale temp files
    await runCompileGate();
    const gate2 = await runCompileGate();
    expect(gate2.status).toBe("ok");
  });

  // ── Version comparison (via probe) ───────────────────────────────

  test("versionGte logic: 1.4.0 >= 1.3.9 (esmBytecode)", async () => {
    const caps = await probeCompileCapabilities();
    if (caps.bunVersion.startsWith("1.4")) {
      expect(caps.esmBytecode).toBe(true); // 1.4.0 >= 1.3.9
    }
  });

  test("versionGte logic: 1.4.0 >= 1.3.7 (cpuProfInterval)", async () => {
    const caps = await probeCompileCapabilities();
    if (caps.bunVersion.startsWith("1.4")) {
      expect(caps.cpuProfInterval).toBe(true);
      expect(caps.cpuProfMd).toBe(true);
    }
  });

  test("versionGte logic: 1.4.0 >= 1.2.0 (heapProf)", async () => {
    const caps = await probeCompileCapabilities();
    if (caps.bunVersion.startsWith("1.4")) {
      expect(caps.heapProf).toBe(true);
    }
  });

  // ── define injection ──────────────────────────────────────────────

  test("compileBinary injects build-time defines", async () => {
    await withTempDir("compile-define-", async (dir) => {
      const entry = `${dir}/entry.ts`;
      const out = `${dir}/entry`;
      writeText(
        entry,
        "console.log(JSON.stringify({ version: KIMI_BUILD_VERSION, channel: KIMI_BUILD_CHANNEL }));\n"
      );

      const result = await compileBinary({
        entryPoint: entry,
        outfile: out,
        define: {
          KIMI_BUILD_VERSION: '"1.2.3"',
          KIMI_BUILD_CHANNEL: '"release"',
        },
        cwd: dir,
      });

      expect(result.ok).toBe(true);

      const proc = Bun.spawn([out], { stdout: "pipe", stderr: "pipe" });
      const stdout = await readableStreamToText(proc.stdout);
      await proc.exited;
      expect(proc.exitCode).toBe(0);

      const parsed = JSON.parse(stdout) as { version: string; channel: string };
      expect(parsed.version).toBe("1.2.3");
      expect(parsed.channel).toBe("release");
    });
  }, 30_000);
});
