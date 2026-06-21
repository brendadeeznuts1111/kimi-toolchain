import { makeDir, removePath, writeText } from "../src/lib/bun-io.ts";

import { describe, expect, test } from "bun:test";
import { join } from "path";
import { DOCTOR_PROBE_SCHEMA_VERSION, buildDoctorProbeManifest } from "../src/lib/doctor-probe.ts";

import { REPO_ROOT, testTempDir } from "./helpers.ts";
describe("doctor-probe", () => {
  test("includes canonicalReferences with manifest for toolchain repo", async () => {
    const tmpHome = testTempDir("probe-refs-");
    const prevHome = Bun.env.HOME;
    makeDir(join(tmpHome, ".kimi-code"), { recursive: true });
    const repoRefs = await Bun.file(join(REPO_ROOT, "canonical-references.json")).text();
    writeText(join(tmpHome, ".kimi-code", "canonical-references.json"), repoRefs);
    Bun.env.HOME = tmpHome;

    try {
      const manifest = await buildDoctorProbeManifest(REPO_ROOT);
      expect(manifest.schemaVersion).toBe(DOCTOR_PROBE_SCHEMA_VERSION);
      expect(manifest.canonicalReferences).not.toBeNull();
      expect(manifest.canonicalReferences?.manifest).not.toBeNull();
      expect(manifest.canonicalReferences?.ecosystemCount).toBeGreaterThan(0);
      expect(manifest.canonicalReferences?.runtimeSynced).toBe(true);
      expect(manifest.checks.some((c) => c.name === "canonical-references")).toBe(true);
      expect(manifest.bunRuntimeCapabilities).not.toBeNull();
      expect(manifest.bunRuntimeCapabilities?.aligned).toBe(true);
      expect(manifest.bunRuntimeCapabilities?.runtimeApiDocs?.globalsUrl).toContain(
        "docs/runtime/globals"
      );
      expect(manifest.bunRuntimeCapabilities?.inventoryKeys).toContain("runtimeApiDocs");
      expect(manifest.checks.some((c) => c.name === "bun-install-runtime")).toBe(true);
      expect(manifest.checks.some((c) => c.name === "artifact-graph")).toBe(true);
      expect(manifest.checks.some((c) => c.name === "bun-image")).toBe(true);
      expect(manifest.bunRuntimeCapabilities?.inventoryKeys).toContain("bunImage");
    } finally {
      Bun.env.HOME = prevHome;
      removePath(tmpHome, { recursive: true, force: true });
    }
  });
});
