import { describe, expect, test } from "bun:test";
import {
  buildDashboardMetaWebView,
  HERDR_DASHBOARD_WEBVIEW_STORE_ENV,
  resolveHerdrDashboardWebViewStore,
} from "../src/lib/herdr-dashboard/webview/store.ts";
import {
  HERDR_DASHBOARD_WEBVIEW_STORE_LEGACY_NAME,
  HERDR_DASHBOARD_WEBVIEW_STORE_NAME,
  herdrDashboardWebViewStoreDir,
} from "../src/lib/paths.ts";
import {
  guardWebViewDataStore,
  versionAtLeast,
  WEBKIT_PERSISTENT_STORAGE_MIN_MACOS,
  webkitPersistentDataStoreSupported,
} from "../src/lib/webview-console.ts";
import { withEnv, withTempDir } from "./helpers.ts";

describe("herdr-dashboard-webview-store", () => {
  test("default store is ephemeral without persist flags", () => {
    const resolved = resolveHerdrDashboardWebViewStore({});
    expect(resolved.mode).toBe("ephemeral");
    expect(resolved.dataStore).toBe("ephemeral");
  });

  test("persist-profile uses descriptive default directory name", () => {
    const resolved = resolveHerdrDashboardWebViewStore({ persistProfile: true });
    if (resolved.mode === "persistent") {
      expect(resolved.directory).toContain(HERDR_DASHBOARD_WEBVIEW_STORE_NAME);
      expect(resolved.directory).not.toContain(HERDR_DASHBOARD_WEBVIEW_STORE_LEGACY_NAME);
    }
  });

  test("--profile-dir wins over default persist path", async () => {
    await withTempDir("herdr-webview-store", async (dir) => {
      const custom = `${dir}/custom-profile`;
      const resolved = resolveHerdrDashboardWebViewStore({ profileDir: custom });
      expect(resolved.mode).toBe("persistent");
      expect(resolved.directory).toBe(custom);
    });
  });

  test("HERDR_DASHBOARD_WEBVIEW_STORE env overrides default persist directory", async () => {
    await withTempDir("herdr-webview-store-env", async (dir) => {
      const fromEnv = `${dir}/from-env`;
      await withEnv({ [HERDR_DASHBOARD_WEBVIEW_STORE_ENV]: fromEnv }, () => {
        const resolved = resolveHerdrDashboardWebViewStore({ persistProfile: true });
        expect(resolved.directory).toBe(fromEnv);
      });
    });
  });

  test("versionAtLeast compares macOS product versions", () => {
    expect(versionAtLeast("15.2.0", WEBKIT_PERSISTENT_STORAGE_MIN_MACOS)).toBe(true);
    expect(versionAtLeast("15.1.9", WEBKIT_PERSISTENT_STORAGE_MIN_MACOS)).toBe(false);
    expect(versionAtLeast("16.0", WEBKIT_PERSISTENT_STORAGE_MIN_MACOS)).toBe(true);
  });

  test("guardWebViewDataStore falls back to ephemeral on old WebKit macOS", () => {
    const warnings: string[] = [];
    const result = guardWebViewDataStore({
      dataStore: { directory: "/tmp/herdr-test-profile" },
      backend: "webkit",
      warn: (message) => warnings.push(message),
    });
    if (webkitPersistentDataStoreSupported("15.2.0")) {
      expect(result).toEqual({ directory: "/tmp/herdr-test-profile" });
    } else {
      expect(result).toBe("ephemeral");
      expect(warnings.some((line) => line.includes("macOS 15.2"))).toBe(true);
    }
  });

  test("herdrDashboardWebViewStoreDir uses new default folder name", () => {
    const path = herdrDashboardWebViewStoreDir("/tmp/home");
    expect(path).toBe(`/tmp/home/.kimi-code/var/${HERDR_DASHBOARD_WEBVIEW_STORE_NAME}`);
  });

  test("buildDashboardMetaWebView serializes shell and persist profile", async () => {
    await withTempDir("herdr-meta-webview", async (dir) => {
      const custom = `${dir}/profile`;
      const meta = buildDashboardMetaWebView({
        shell: "webview",
        persistProfile: true,
        profileDir: custom,
        backend: "webkit",
        home: "/tmp/home",
      });
      expect(meta.shell).toBe("webview");
      expect(meta.persistProfile).toBe(true);
      expect(meta.profileDir).toBe(custom);
      expect(meta.directory).toBe(custom);
      expect(meta.defaultProfileDir).toBe(
        `/tmp/home/.kimi-code/var/${HERDR_DASHBOARD_WEBVIEW_STORE_NAME}`
      );
      expect(meta.backend).toBe("webkit");
    });
  });
});
