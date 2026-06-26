import { afterEach, describe, expect, mock, test } from "bun:test";
import { Effect } from "effect";
import type { HerdrCliError } from "../src/lib/herdr-cli.ts";

// ── Controlled mocks ────────────────────────────────────────────────────

let mockCliJson: string | null = null;
let mockCliError: HerdrCliError | null = null;

let mockCliSyncJson: string | null = null;
let mockCliSyncThrow: Error | null = null;

mock.module("../src/lib/herdr-cli.ts", () => ({
  herdrCli: () => {
    if (mockCliError) return Effect.fail(mockCliError);
    return Effect.succeed(mockCliJson ?? "{}");
  },
  herdrCliJson: <T>() => {
    if (mockCliError) return Effect.fail(mockCliError);
    return Effect.succeed((mockCliJson ? JSON.parse(mockCliJson) : {}) as T);
  },
  herdrCliSync: () => {
    if (mockCliSyncThrow) throw mockCliSyncThrow;
    return mockCliSyncJson ?? "{}";
  },
  herdrCliJsonSync: () => {
    if (mockCliSyncThrow) throw mockCliSyncThrow;
    return mockCliSyncJson ?? mockCliJson ?? "{}";
  },
  herdrCliError: (stderr: string, exitCode: number | null, context: string): HerdrCliError => ({
    _tag: "HerdrCliError" as const,
    message: `herdr ${context}: ${stderr.slice(0, 200)}`,
    stderr,
    exitCode,
  }),
}));

// ── Dynamic import after mocks ──────────────────────────────────────────

const workspaceService = await import("../src/lib/herdr-workspace-service.ts");

afterEach(() => {
  mockCliJson = null;
  mockCliError = null;
  mockCliSyncJson = null;
  mockCliSyncThrow = null;
});

// ── Tests ───────────────────────────────────────────────────────────────

describe("herdr-workspace-service", () => {
  describe("listWorkspaces", () => {
    test("parses workspace list JSON", async () => {
      mockCliJson = JSON.stringify({
        result: {
          workspaces: [
            {
              workspace_id: "ws_1",
              label: "main",
              cwd: "/home/projects/app",
              focused: true,
              tab_count: 3,
              pane_count: 5,
            },
            {
              workspace_id: "ws_2",
              label: "side",
              cwd: "/home/projects/lib",
              focused: false,
              tab_count: 1,
              pane_count: 2,
            },
          ],
        },
      });

      const result = await Effect.runPromise(workspaceService.listWorkspaces());

      expect(result).toHaveLength(2);
      expect(result[0]!.workspaceId).toBe("ws_1");
      expect(result[0]!.label).toBe("main");
      expect(result[0]!.focused).toBe(true);
      expect(result[0]!.tabCount).toBe(3);
      expect(result[0]!.paneCount).toBe(5);
      expect(result[1]!.workspaceId).toBe("ws_2");
      expect(result[1]!.focused).toBe(false);
    });

    test("handles empty workspace list", async () => {
      mockCliJson = JSON.stringify({ result: { workspaces: [] } });
      const result = await Effect.runPromise(workspaceService.listWorkspaces());
      expect(result).toHaveLength(0);
    });

    test("handles missing result field", async () => {
      mockCliJson = JSON.stringify({});
      const result = await Effect.runPromise(workspaceService.listWorkspaces());
      expect(result).toHaveLength(0);
    });

    test("propagates CLI errors", async () => {
      mockCliError = {
        _tag: "HerdrCliError" as const,
        message: "herdr workspace: connection refused",
        stderr: "connection refused",
        exitCode: 1,
      };

      await expect(Effect.runPromise(workspaceService.listWorkspaces())).rejects.toThrow();
    });
  });

  describe("getWorkspace", () => {
    test("parses single workspace JSON", async () => {
      mockCliJson = JSON.stringify({
        result: {
          workspace: {
            workspace_id: "ws_1",
            label: "main",
            cwd: "/home/projects/app",
            focused: true,
            tab_count: 3,
            pane_count: 5,
          },
        },
      });

      const result = await Effect.runPromise(workspaceService.getWorkspace("ws_1"));

      expect(result.workspaceId).toBe("ws_1");
      expect(result.label).toBe("main");
      expect(result.cwd).toBe("/home/projects/app");
      expect(result.tabCount).toBe(3);
      expect(result.paneCount).toBe(5);
    });

    test("falls back to provided workspaceId when missing in response", async () => {
      mockCliJson = JSON.stringify({ result: { workspace: { label: "ghost" } } });

      const result = await Effect.runPromise(workspaceService.getWorkspace("ws_missing"));

      expect(result.workspaceId).toBe("ws_missing");
      expect(result.label).toBe("ghost");
    });
  });

  describe("createWorkspace", () => {
    test("returns workspace, tab, and root pane IDs", async () => {
      mockCliJson = JSON.stringify({
        result: {
          workspace: { workspace_id: "ws_new" },
          tab: { tab_id: "tab_new" },
          root_pane: { pane_id: "pane_new" },
        },
      });

      const result = await Effect.runPromise(
        workspaceService.createWorkspace({ label: "new-workspace" })
      );

      expect(result.workspaceId).toBe("ws_new");
      expect(result.tabId).toBe("tab_new");
      expect(result.rootPaneId).toBe("pane_new");
    });
  });

  describe("focusWorkspace / renameWorkspace / closeWorkspace", () => {
    test("focusWorkspace succeeds", async () => {
      mockCliJson = "";
      await expect(
        Effect.runPromise(workspaceService.focusWorkspace("ws_1"))
      ).resolves.toBeUndefined();
    });

    test("renameWorkspace succeeds", async () => {
      mockCliJson = "";
      await expect(
        Effect.runPromise(workspaceService.renameWorkspace("ws_1", "new-name"))
      ).resolves.toBeUndefined();
    });

    test("closeWorkspace succeeds", async () => {
      mockCliJson = "";
      await expect(
        Effect.runPromise(workspaceService.closeWorkspace("ws_1"))
      ).resolves.toBeUndefined();
    });
  });

  // ── Sync wrappers ────────────────────────────────────────────────────

  describe("listWorkspacesSync", () => {
    test("returns ok with parsed workspaces", () => {
      mockCliSyncJson = JSON.stringify({
        result: {
          workspaces: [
            {
              workspace_id: "ws_sync",
              label: "sync-ws",
              cwd: "/tmp",
              focused: true,
              tab_count: 1,
              pane_count: 1,
            },
          ],
        },
      });

      const result = workspaceService.listWorkspacesSync();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.workspaces).toHaveLength(1);
        expect(result.workspaces[0]!.workspaceId).toBe("ws_sync");
        expect(result.workspaces[0]!.label).toBe("sync-ws");
        expect(result.workspaces[0]!.focused).toBe(true);
        expect(result.workspaces[0]!.paneCount).toBe(1);
      }
    });

    test("returns error on CLI failure", () => {
      mockCliSyncThrow = new Error("herdr workspace: exit 1");
      const result = workspaceService.listWorkspacesSync();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("exit 1");
      }
    });

    test("handles missing result field gracefully", () => {
      mockCliSyncJson = JSON.stringify({});
      const result = workspaceService.listWorkspacesSync();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.workspaces).toHaveLength(0);
      }
    });
  });

  describe("getWorkspaceSync", () => {
    test("returns ok with workspace details", () => {
      mockCliSyncJson = JSON.stringify({
        result: {
          workspace: {
            workspace_id: "ws_get",
            label: "get-ws",
            cwd: "/tmp",
            focused: false,
            tab_count: 2,
            pane_count: 4,
          },
        },
      });

      const result = workspaceService.getWorkspaceSync("ws_get");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.workspace.workspaceId).toBe("ws_get");
        expect(result.workspace.tabCount).toBe(2);
        expect(result.workspace.paneCount).toBe(4);
      }
    });

    test("returns error on invalid JSON", () => {
      mockCliSyncJson = "not json";
      const result = workspaceService.getWorkspaceSync("ws_bad");
      expect(result.ok).toBe(false);
    });

    test("returns error on CLI failure", () => {
      mockCliSyncThrow = new Error("not found");
      const result = workspaceService.getWorkspaceSync("ws_404");
      expect(result.ok).toBe(false);
    });
  });

  describe("createWorkspaceSync", () => {
    test("returns ok with IDs", () => {
      mockCliSyncJson = JSON.stringify({
        result: {
          workspace: { workspace_id: "ws_c" },
          tab: { tab_id: "tab_c" },
          root_pane: { pane_id: "pane_c" },
        },
      });

      const result = workspaceService.createWorkspaceSync({ label: "created" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.workspaceId).toBe("ws_c");
        expect(result.tabId).toBe("tab_c");
        expect(result.rootPaneId).toBe("pane_c");
      }
    });

    test("returns error on CLI failure", () => {
      mockCliSyncThrow = new Error("disk full");
      const result = workspaceService.createWorkspaceSync();
      expect(result.ok).toBe(false);
    });
  });

  describe("focusWorkspaceSync / renameWorkspaceSync / closeWorkspaceSync", () => {
    test("focusWorkspaceSync succeeds", () => {
      mockCliSyncJson = "";
      expect(workspaceService.focusWorkspaceSync("ws_f").ok).toBe(true);
    });

    test("focusWorkspaceSync returns error on failure", () => {
      mockCliSyncThrow = new Error("bad target");
      const result = workspaceService.focusWorkspaceSync("ws_bad");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("bad target");
    });

    test("renameWorkspaceSync succeeds", () => {
      mockCliSyncJson = "";
      expect(workspaceService.renameWorkspaceSync("ws_r", "renamed").ok).toBe(true);
    });

    test("closeWorkspaceSync succeeds", () => {
      mockCliSyncJson = "";
      expect(workspaceService.closeWorkspaceSync("ws_c").ok).toBe(true);
    });

    test("closeWorkspaceSync returns error on failure", () => {
      mockCliSyncThrow = new Error("still has tabs");
      const result = workspaceService.closeWorkspaceSync("ws_stuck");
      expect(result.ok).toBe(false);
    });
  });
});
