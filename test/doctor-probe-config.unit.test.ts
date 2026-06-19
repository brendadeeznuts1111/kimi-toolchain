import { describe, expect, test } from "bun:test";
import { join } from "path";
import { readDoctorConfig, readDoctorProbeConfig } from "../src/lib/doctor-probe-config.ts";
import { withTempDir } from "./helpers.ts";

describe("doctor-probe-config", () => {
  test("reads [doctor.probe] port and interval from dx.config.toml", async () => {
    await withTempDir("doctor-probe-config-", async (dir) => {
      await Bun.write(
        join(dir, "dx.config.toml"),
        `[doctor.probe]
port = 5678
interval = 15000
host = "127.0.0.1"
`
      );

      const config = await readDoctorProbeConfig(dir);
      expect(config.port).toBe(5678);
      expect(config.intervalMs).toBe(15000);
      expect(config.host).toBe("127.0.0.1");
    });
  });

  test("returns empty config when dx.config.toml is missing", async () => {
    await withTempDir("doctor-probe-config-missing-", async (dir) => {
      const config = await readDoctorProbeConfig(dir);
      expect(config).toEqual({});
    });
  });

  test("PROBE_SERVER_PORT env overrides [doctor.probe].port", async () => {
    await withTempDir("doctor-probe-env-", async (dir) => {
      await Bun.write(
        join(dir, "dx.config.toml"),
        `[doctor.probe]
port = 5678
`
      );
      const prev = Bun.env.PROBE_SERVER_PORT;
      Bun.env.PROBE_SERVER_PORT = "59999";
      try {
        const { resolveProbeServerUrl } = await import("../src/lib/doctor-probe-config.ts");
        const url = await resolveProbeServerUrl(dir);
        expect(url).toBe("http://127.0.0.1:59999");
      } finally {
        if (prev === undefined) delete Bun.env.PROBE_SERVER_PORT;
        else Bun.env.PROBE_SERVER_PORT = prev;
      }
    });
  });

  test("reads [doctor].tabs inline array with name and command", async () => {
    await withTempDir("doctor-config-tabs-", async (dir) => {
      await Bun.write(
        join(dir, "dx.config.toml"),
        `[doctor]
tabs = [
  { name = "probe", command = "kimi-doctor --serve-probe" },
  { name = "bunfig", command = "kimi-doctor --gate bunfig-policy" },
]

[doctor.probe]
port = 5678
interval = 15000
`
      );

      const config = await readDoctorConfig(dir);
      expect(config.tabs).toEqual([
        { name: "probe", command: "kimi-doctor --serve-probe" },
        { name: "bunfig", command: "kimi-doctor --gate bunfig-policy" },
      ]);
      expect(config.probe.port).toBe(5678);
      expect(config.probe.intervalMs).toBe(15000);
    });
  });
});