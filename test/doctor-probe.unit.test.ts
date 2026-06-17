import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { buildCanonicalReferencesManifest } from "../src/lib/canonical-references.ts";
import { DOCTOR_PROBE_SCHEMA_VERSION, buildDoctorProbeManifest } from "../src/lib/doctor-probe.ts";

const REPO_ROOT = import.meta.dir + "/..";

describe("doctor-probe", () => {
  test("includes canonicalReferences with manifest for toolchain repo", async () => {
    const tmpHome = join(tmpdir(), `probe-refs-${Bun.randomUUIDv7()}`);
    const prevHome = Bun.env.HOME;
    mkdirSync(join(tmpHome, ".kimi-code"), { recursive: true });
    writeFileSync(
      join(tmpHome, ".kimi-code", "canonical-references.json"),
      JSON.stringify(buildCanonicalReferencesManifest(), null, 2)
    );
    Bun.env.HOME = tmpHome;

    try {
      const manifest = await buildDoctorProbeManifest(REPO_ROOT);
      expect(manifest.schemaVersion).toBe(DOCTOR_PROBE_SCHEMA_VERSION);
      expect(manifest.canonicalReferences).not.toBeNull();
      expect(manifest.canonicalReferences?.manifest).not.toBeNull();
      expect(manifest.canonicalReferences?.ecosystemCount).toBeGreaterThan(0);
      expect(manifest.canonicalReferences?.runtimeSynced).toBe(true);
      expect(manifest.checks.some((c) => c.name === "canonical-references")).toBe(true);
    } finally {
      Bun.env.HOME = prevHome;
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });
});
