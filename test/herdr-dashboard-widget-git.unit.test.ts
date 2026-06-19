import { describe, expect, test } from "bun:test";
import {
  clampGitWidgetCommits,
  fetchDashboardGitWidget,
  GIT_WIDGET_DEFAULT_COMMITS,
  GIT_WIDGET_MAX_COMMITS,
  isRemoteProjectPathMissing,
  parseGitLogFormatted,
  parseGitStatusPorcelain,
  resolveRemoteGitDirectoryError,
} from "../src/lib/herdr-dashboard-widget-git.ts";
import type { DashboardGitWidgetData } from "../src/lib/herdr-dashboard-widget-git.ts";
import { REPO_ROOT } from "./helpers.ts";

const primaryCatalog = [{ session: "", label: "primary", host: "(local)", reachable: true }];

const sampleGitData: DashboardGitWidgetData = {
  branch: "main",
  dirty: true,
  changedCount: 1,
  status: [{ xy: " M", path: "src/foo.ts" }],
  commits: [{ sha: "abc1234", subject: "feat: git widget", date: "2026-06-18T00:00:00+00:00" }],
  commitLimit: 10,
};

describe("herdr-dashboard-widget-git", () => {
  test("clampGitWidgetCommits defaults and clamps", () => {
    expect(clampGitWidgetCommits(undefined)).toBe(GIT_WIDGET_DEFAULT_COMMITS);
    expect(clampGitWidgetCommits(0)).toBe(1);
    expect(clampGitWidgetCommits(99)).toBe(GIT_WIDGET_MAX_COMMITS);
    expect(clampGitWidgetCommits(20)).toBe(20);
  });

  test("parseGitStatusPorcelain maps porcelain rows", () => {
    const rows = parseGitStatusPorcelain(" M src/a.ts\n?? new.ts\nR  old.ts -> new-name.ts\n");
    expect(rows).toEqual([
      { xy: " M", path: "src/a.ts" },
      { xy: "??", path: "new.ts" },
      { xy: "R ", path: "new-name.ts" },
    ]);
  });

  test("parseGitLogFormatted maps tab-separated log lines", () => {
    const rows = parseGitLogFormatted("abc1234\tfeat: widget\t2026-06-18T00:00:00+00:00\n");
    expect(rows).toEqual([
      { sha: "abc1234", subject: "feat: widget", date: "2026-06-18T00:00:00+00:00" },
    ]);
  });

  test("isRemoteProjectPathMissing detects directory errors", () => {
    expect(
      isRemoteProjectPathMissing("bash: line 0: cd: /missing: No such file or directory")
    ).toBe(true);
    expect(isRemoteProjectPathMissing("cannot access '/missing': No such file or directory")).toBe(
      true
    );
    expect(isRemoteProjectPathMissing("permission denied (publickey)")).toBe(false);
  });

  test("resolveRemoteGitDirectoryError maps missing path before raw SSH noise", () => {
    expect(resolveRemoteGitDirectoryError("", "mac-mini")).toBe(
      "project path not found on remote host"
    );
    expect(
      resolveRemoteGitDirectoryError("test: /missing: No such file or directory", "mac-mini")
    ).toBe("project path not found on remote host");
    expect(resolveRemoteGitDirectoryError("permission denied (publickey)", "mac-mini")).toContain(
      "SSH authentication failed"
    );
  });

  test("fetchDashboardGitWidget rejects unknown session", async () => {
    const result = await fetchDashboardGitWidget(REPO_ROOT, {
      session: "staging",
      catalog: primaryCatalog,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not in catalog");
  });

  test("fetchDashboardGitWidget returns git data for primary session", async () => {
    const result = await fetchDashboardGitWidget(
      REPO_ROOT,
      { session: "", catalog: primaryCatalog, commits: 10 },
      {
        readLocalGit: async (projectPath, commitLimit) => {
          expect(projectPath).toBe(REPO_ROOT);
          expect(commitLimit).toBe(10);
          return { ok: true, data: sampleGitData };
        },
      }
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.branch).toBe("main");
      expect(result.data.changedCount).toBe(1);
      expect(result.data.commits[0]?.sha).toBe("abc1234");
    }
  });

  test("fetchDashboardGitWidget surfaces not-a-repo before branch/status", async () => {
    let calls = 0;
    const result = await fetchDashboardGitWidget(
      REPO_ROOT,
      { session: "", catalog: primaryCatalog },
      {
        readLocalGit: async () => {
          calls += 1;
          return { ok: false, error: "not a git repository" };
        },
      }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("not a git repository");
    expect(calls).toBe(1);
  });
});
