import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "fs";
import { artifactPath } from "../src/lib/artifacts.ts";
import { getPersistentWarnings, recordDoctorRun } from "../src/lib/doctor-runs.ts";

const REPO_ROOT = import.meta.dir + "/..";

describe("doctor-runs", () => {
  let prevHome: string | undefined;
  let testHome: string;

  beforeEach(() => {
    prevHome = Bun.env.HOME;
    testHome = artifactPath(REPO_ROOT, "tmp", `doctor-${Date.now()}`);
    mkdirSync(testHome, { recursive: true });
    Bun.env.HOME = testHome;
  });

  afterEach(() => {
    if (prevHome) Bun.env.HOME = prevHome;
    if (testHome && existsSync(testHome)) rmSync(testHome, { recursive: true, force: true });
  });

  test("recordDoctorRun inserts new warning trend", () => {
    recordDoctorRun("proj-a", "tool-a", [
      { check: "new-check", message: "first", severity: "warn" },
    ]);
    const warnings = getPersistentWarnings("tool-a");
    expect(warnings.some((w) => w.check_name === "new-check")).toBe(true);
    expect(warnings.find((w) => w.check_name === "new-check")?.occurrence_count).toBe(1);
  });

  test("recordDoctorRun increments existing warning count", () => {
    recordDoctorRun("proj-a", "tool-b", [
      { check: "repeat-check", message: "one", severity: "warn" },
    ]);
    recordDoctorRun("proj-a", "tool-b", [
      { check: "repeat-check", message: "two", severity: "warn" },
    ]);
    const w = getPersistentWarnings("tool-b").find((x) => x.check_name === "repeat-check");
    expect(w?.occurrence_count).toBe(2);
  });

  test("empty warnings resolves open trends", () => {
    recordDoctorRun("proj-a", "tool-c", [
      { check: "will-resolve", message: "x", severity: "warn" },
    ]);
    recordDoctorRun("proj-a", "tool-c", []);
    const open = getPersistentWarnings("tool-c").filter((w) => w.check_name === "will-resolve");
    expect(open.length).toBe(0);
  });

  test("getPersistentWarnings without tool filter returns open warnings", () => {
    recordDoctorRun("proj-a", "tool-x", [{ check: "x-check", message: "x", severity: "warn" }]);
    const all = getPersistentWarnings();
    expect(all.some((w) => w.tool === "tool-x" && w.check_name === "x-check")).toBe(true);
  });
});
