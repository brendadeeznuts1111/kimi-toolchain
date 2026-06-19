import { describe, expect, test } from "bun:test";
import type { DashboardMetaDiscovery } from "../src/lib/herdr-dashboard-discovery-meta.ts";
import {
  DASHBOARD_META_VALID_RESOLUTIONS,
  isValidWorkspaceIdResolution,
  resolveRemoteHostsConfigured,
  validateDashboardMetaDiscovery,
  validateRemoteHostsReachable,
} from "../src/lib/herdr-dashboard-meta-gate.ts";

function baseDiscovery(overrides: Partial<DashboardMetaDiscovery> = {}): DashboardMetaDiscovery {
  return {
    herdrSession: "",
    herdrSessionLabel: "primary",
    mode: "workspace",
    workspaceLabel: "kimi-toolchain",
    workspaceId: "wB",
    workspaceIdResolution: "single",
    workspaceCandidateCount: 1,
    remoteHostsConfigured: 0,
    remoteHosts: { configured: 0, reachable: 0, hosts: [] },
    multiSessionEnabled: false,
    sessionsAvailable: [""],
    sessionCatalog: [{ session: "", label: "primary", host: "(local)", reachable: true }],
    ...overrides,
  };
}

describe("herdr-dashboard-meta-gate", () => {
  test("isValidWorkspaceIdResolution accepts canonical values", () => {
    for (const resolution of DASHBOARD_META_VALID_RESOLUTIONS) {
      expect(isValidWorkspaceIdResolution(resolution)).toBe(true);
    }
    expect(isValidWorkspaceIdResolution(undefined)).toBe(false);
    expect(isValidWorkspaceIdResolution("stale")).toBe(false);
  });

  test("validateDashboardMetaDiscovery passes well-formed discovery", () => {
    expect(validateDashboardMetaDiscovery(baseDiscovery())).toBeNull();
  });

  test("validateDashboardMetaDiscovery rejects missing resolution", () => {
    const failure = validateDashboardMetaDiscovery({
      workspaceCandidateCount: 1,
    });
    expect(failure?.code).toBe("invalid_resolution");
  });

  test("validateDashboardMetaDiscovery rejects undefined resolution default", () => {
    const failure = validateDashboardMetaDiscovery({
      workspaceIdResolution: undefined,
      workspaceCandidateCount: 0,
    });
    expect(failure?.code).toBe("invalid_resolution");
  });

  test("validateDashboardMetaDiscovery rejects negative candidate count", () => {
    const failure = validateDashboardMetaDiscovery({
      workspaceIdResolution: "none",
      workspaceCandidateCount: -1,
    });
    expect(failure?.code).toBe("invalid_candidate_count");
  });

  test("validateDashboardMetaDiscovery accepts none with count 0", () => {
    expect(
      validateDashboardMetaDiscovery({
        workspaceIdResolution: "none",
        workspaceCandidateCount: 0,
      })
    ).toBeNull();
  });

  test("default mode passes when reachable < configured", () => {
    expect(
      validateDashboardMetaDiscovery(
        baseDiscovery({
          remoteHosts: {
            configured: 2,
            reachable: 0,
            hosts: [
              { label: "mac-mini", reachable: false, error: "timeout" },
              { label: "mac-studio", reachable: false, error: "refused" },
            ],
          },
        })
      )
    ).toBeNull();
  });

  test("strict mode fails when reachable < configured with host detail", () => {
    const failure = validateDashboardMetaDiscovery(
      baseDiscovery({
        remoteHosts: {
          configured: 2,
          reachable: 0,
          hosts: [
            { label: "mac-mini", reachable: false, error: "timeout" },
            { label: "mac-studio", reachable: false, error: "connection refused" },
          ],
        },
      }),
      { strict: true }
    );
    expect(failure?.code).toBe("remote_hosts_unreachable");
    expect(failure?.detail).toContain("mac-mini: timeout");
    expect(failure?.detail).toContain("mac-studio: connection refused");
  });

  test("strict mode passes when reachable equals configured", () => {
    expect(
      validateDashboardMetaDiscovery(
        baseDiscovery({
          remoteHosts: {
            configured: 2,
            reachable: 2,
            hosts: [
              { label: "mac-mini", reachable: true, version: "1.0" },
              { label: "mac-studio", reachable: true, version: "1.0" },
            ],
          },
        }),
        { strict: true }
      )
    ).toBeNull();
  });

  test("strict mode passes when configured is 0", () => {
    expect(
      validateDashboardMetaDiscovery(
        baseDiscovery({
          remoteHosts: { configured: 0, reachable: 0, hosts: [] },
        }),
        { strict: true }
      )
    ).toBeNull();
  });

  test("strict fails on missing remoteHosts block when legacy configured > 0", () => {
    const row = baseDiscovery({ remoteHostsConfigured: 2 });
    delete (row as { remoteHosts?: DashboardMetaDiscovery["remoteHosts"] }).remoteHosts;
    const failure = validateDashboardMetaDiscovery(row, { strict: true });
    expect(failure?.code).toBe("missing_remote_hosts");
    expect(failure?.detail).toContain("remoteHosts block missing");
  });

  test("resolveRemoteHostsConfigured prefers remoteHosts.configured over legacy", () => {
    const row = baseDiscovery({
      remoteHostsConfigured: 9,
      remoteHosts: { configured: 2, reachable: 1, hosts: [] },
    });
    expect(resolveRemoteHostsConfigured(row)).toBe(2);
  });

  test("resolveRemoteHostsConfigured falls back to legacy when block missing", () => {
    const row = baseDiscovery({ remoteHostsConfigured: 3 });
    delete (row as { remoteHosts?: DashboardMetaDiscovery["remoteHosts"] }).remoteHosts;
    expect(resolveRemoteHostsConfigured(row)).toBe(3);
  });

  test("strict fails when hosts array empty but configured > 0", () => {
    const failure = validateRemoteHostsReachable(
      baseDiscovery({
        remoteHosts: { configured: 2, reachable: 0, hosts: [] },
      })
    );
    expect(failure?.code).toBe("remote_hosts_unreachable");
    expect(failure?.detail).toContain("hosts[] empty");
  });

  test("strict passes when hosts array empty and configured is 0", () => {
    expect(
      validateRemoteHostsReachable(
        baseDiscovery({
          remoteHosts: { configured: 0, reachable: 0, hosts: [] },
        })
      )
    ).toBeNull();
  });
});
