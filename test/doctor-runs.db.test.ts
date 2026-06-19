import { makeDir, pathExists, removePath } from "../src/lib/bun-io.ts";

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { Database } from "bun:sqlite";
import {
  getDoctorRunsByProject,
  getDoctorRunsByRunId,
  getDoctorRunsBySession,
  getPersistentWarnings,
  recordDoctorRun,
} from "../src/lib/doctor-runs.ts";
import { varDir } from "../src/lib/paths.ts";

import { REPO_ROOT } from "./helpers.ts";
describe("doctor-runs", () => {
  let prevHome: string | undefined;
  let testHome: string;

  beforeEach(() => {
    prevHome = Bun.env.HOME;
    testHome = join(REPO_ROOT, `.tmp-doctor-${Date.now()}`);
    makeDir(testHome, { recursive: true });
    Bun.env.HOME = testHome;
  });

  afterEach(() => {
    if (prevHome) Bun.env.HOME = prevHome;
    if (testHome && pathExists(testHome)) removePath(testHome, { recursive: true, force: true });
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

  test("recordDoctorRun persists run_id when provided", () => {
    recordDoctorRun(
      "proj-a",
      "tool-run",
      [{ check: "run-check", message: "ok", severity: "warn" }],
      undefined,
      undefined,
      "sess-1",
      "run_test_123"
    );
    const db = new Database(join(varDir(), "sessions.db"));
    const row = db
      .query("SELECT session_id, run_id FROM doctor_runs WHERE tool = ? ORDER BY id DESC LIMIT 1")
      .get("tool-run") as { session_id: string | null; run_id: string | null };
    db.close();
    expect(row.session_id).toBe("sess-1");
    expect(row.run_id).toBe("run_test_123");
  });

  test("getDoctorRunsByRunId returns matching runs newest first", () => {
    recordDoctorRun(
      "proj-a",
      "tool-run-a",
      [{ check: "a", message: "x", severity: "warn" }],
      undefined,
      undefined,
      "sess-a",
      "run_query_1"
    );
    recordDoctorRun(
      "proj-a",
      "tool-run-b",
      [{ check: "b", message: "x", severity: "warn" }],
      undefined,
      undefined,
      "sess-a",
      "run_query_1"
    );
    recordDoctorRun(
      "proj-a",
      "tool-run-c",
      [{ check: "c", message: "x", severity: "warn" }],
      undefined,
      undefined,
      "sess-b",
      "run_query_2"
    );
    const runs = getDoctorRunsByRunId("run_query_1");
    expect(runs.length).toBe(2);
    expect(runs[0]!.tool).toBe("tool-run-b");
    expect(runs.every((r) => r.runId === "run_query_1")).toBe(true);
  });

  test("getDoctorRunsBySession returns matching runs", () => {
    recordDoctorRun(
      "proj-a",
      "tool-sess-a",
      [{ check: "x", message: "x", severity: "warn" }],
      undefined,
      undefined,
      "sess-query-a"
    );
    const runs = getDoctorRunsBySession("sess-query-a");
    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(runs.every((r) => r.sessionId === "sess-query-a")).toBe(true);
  });

  test("getDoctorRunsByProject returns matching runs", () => {
    recordDoctorRun("proj-query-x", "tool-proj", [{ check: "x", message: "x", severity: "warn" }]);
    const runs = getDoctorRunsByProject("proj-query-x");
    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(runs.every((r) => r.project === "proj-query-x")).toBe(true);
  });
});
