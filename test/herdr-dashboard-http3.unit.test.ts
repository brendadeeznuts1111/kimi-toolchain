import { describe, expect, test } from "bun:test";
import { join } from "path";
import { $ } from "bun";
import { writeText } from "../src/lib/bun-io.ts";
import {
  BUN_HTTP3_MIN_VERSION,
  HERDR_DASHBOARD_HTTP3_ENV,
  HERDR_DASHBOARD_TLS_CERT_ENV,
  HERDR_DASHBOARD_TLS_KEY_ENV,
  bunHttp3ServeSupported,
  dashboardHttp3Requested,
  dashboardServeScheme,
  resolveDashboardServeTransport,
  resolveDashboardTlsPaths,
} from "../src/lib/herdr-dashboard/server/http3.ts";
import { startHerdrDashboardServer } from "../src/lib/herdr-dashboard/server/server.ts";
import { readableStreamToText } from "../src/lib/bun-utils.ts";
import { REPO_ROOT, withEnv, withTempDir } from "./helpers.ts";

const HTTP3_TEST_MS = 25_000;

async function writeLocalhostTlsPair(dir: string): Promise<{ certPath: string; keyPath: string }> {
  const certPath = join(dir, "localhost-cert.pem");
  const keyPath = join(dir, "localhost-key.pem");
  const result =
    await $`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${keyPath} -out ${certPath} -days 1 -subj /CN=localhost`
      .quiet()
      .nothrow();
  if (result.exitCode !== 0) {
    throw new Error(`openssl failed: ${result.stderr.toString()}`);
  }
  return { certPath, keyPath };
}

describe("herdr-dashboard-http3", () => {
  test("bunHttp3ServeSupported matches Bun semver floor", () => {
    const supported = bunHttp3ServeSupported();
    expect(typeof supported).toBe("boolean");
    if (Bun.semver.satisfies(Bun.version, `>=${BUN_HTTP3_MIN_VERSION}`)) {
      expect(supported).toBe(true);
    } else {
      expect(supported).toBe(false);
    }
  });

  test("dashboardHttp3Requested honors CLI option and env", () => {
    expect(dashboardHttp3Requested(false)).toBe(false);
    expect(dashboardHttp3Requested(true)).toBe(true);

    withEnv({ [HERDR_DASHBOARD_HTTP3_ENV]: "1" }, () => {
      expect(dashboardHttp3Requested()).toBe(true);
      expect(dashboardHttp3Requested(false)).toBe(false);
    });

    withEnv({ [HERDR_DASHBOARD_HTTP3_ENV]: "yes" }, () => {
      expect(dashboardHttp3Requested()).toBe(true);
    });
  });

  test(
    "resolveDashboardTlsPaths requires readable cert and key files",
    async () => {
      await withTempDir("herdr-dashboard-http3", async (dir) => {
        const { certPath, keyPath } = await writeLocalhostTlsPair(dir);

        expect(resolveDashboardTlsPaths()).toBeNull();

        withEnv(
          {
            [HERDR_DASHBOARD_TLS_CERT_ENV]: certPath,
            [HERDR_DASHBOARD_TLS_KEY_ENV]: keyPath,
          },
          () => {
            expect(resolveDashboardTlsPaths()).toEqual({ certPath, keyPath });
          }
        );

        const missingKey = join(dir, "missing-key.pem");
        expect(resolveDashboardTlsPaths({ certPath, keyPath: missingKey })).toBeNull();

        writeText(missingKey, "not-a-key");
        expect(resolveDashboardTlsPaths({ certPath, keyPath: missingKey })).toEqual({
          certPath,
          keyPath: missingKey,
        });
      });
    },
    { timeout: HTTP3_TEST_MS }
  );

  test("resolveDashboardServeTransport falls back without TLS material", () => {
    const resolved = resolveDashboardServeTransport({ http3: true });
    if (bunHttp3ServeSupported()) {
      expect(resolved.transport.tls).toBe(false);
      expect(resolved.transport.http3).toBe(false);
      expect(resolved.transport.fallbackReason).toContain(HERDR_DASHBOARD_TLS_CERT_ENV);
    } else {
      expect(resolved.transport.fallbackReason).toContain(BUN_HTTP3_MIN_VERSION);
    }
    expect(Object.keys(resolved.serveOptions)).toHaveLength(0);
  });

  test(
    "resolveDashboardServeTransport enables TLS+HTTP/3 when certs exist",
    async () => {
      if (!bunHttp3ServeSupported()) return;

      await withTempDir("herdr-dashboard-http3-serve", async (dir) => {
        const { certPath, keyPath } = await writeLocalhostTlsPair(dir);
        const resolved = resolveDashboardServeTransport({
          http3: true,
          certPath,
          keyPath,
        });
        expect(resolved.transport).toEqual({ tls: true, http3: true });
        expect(resolved.serveOptions.http3).toBe(true);
        expect(resolved.serveOptions.tls?.cert).toBeDefined();
        expect(resolved.serveOptions.tls?.key).toBeDefined();
        expect(dashboardServeScheme(resolved.transport)).toBe("https");
      });
    },
    { timeout: HTTP3_TEST_MS }
  );

  test(
    "dashboard server serves HTTPS meta when HTTP/3 transport is active",
    async () => {
      if (!bunHttp3ServeSupported()) return;

      await withTempDir("herdr-dashboard-http3-server", async (dir) => {
        const { certPath, keyPath } = await writeLocalhostTlsPair(dir);
        const server = startHerdrDashboardServer({
          projectPath: REPO_ROOT,
          port: 0,
          sessions: false,
          autoRefresh: false,
          metaWatch: false,
          herdrEvents: false,
          gateHealthWatch: false,
          http3: true,
          tlsCertPath: certPath,
          tlsKeyPath: keyPath,
        });

        try {
          expect(server.url).toStartWith("https://");
          expect(server.transport.http3).toBe(true);

          const response = (await server.fetch("/api/meta")) as unknown as {
            body: ReadableStream<Uint8Array>;
          };
          const meta = JSON.parse(await readableStreamToText(response.body)) as {
            transport?: {
              scheme: string;
              tls: boolean;
              http3: boolean;
              http3Requested: boolean;
            };
          };
          expect(meta.transport?.scheme).toBe("https");
          expect(meta.transport?.tls).toBe(true);
          expect(meta.transport?.http3).toBe(true);
          expect(meta.transport?.http3Requested).toBe(true);
        } finally {
          server.stop();
        }
      });
    },
    { timeout: HTTP3_TEST_MS }
  );

  test(
    "dashboard server falls back to HTTP when HTTP/3 requested without certs",
    async () => {
      const server = startHerdrDashboardServer({
        projectPath: REPO_ROOT,
        port: 0,
        sessions: false,
        autoRefresh: false,
        metaWatch: false,
        herdrEvents: false,
        gateHealthWatch: false,
        http3: true,
      });

      try {
        expect(server.url).toStartWith("http://");
        expect(server.transport.http3).toBe(false);
        expect(server.transport.fallbackReason).toBeTruthy();

        const response = (await server.fetch("/api/meta")) as unknown as {
          body: ReadableStream<Uint8Array>;
        };
        const meta = JSON.parse(await readableStreamToText(response.body)) as {
          transport?: { scheme: string; http3: boolean; fallbackReason?: string };
        };
        expect(meta.transport?.scheme).toBe("http");
        expect(meta.transport?.http3).toBe(false);
        expect(meta.transport?.fallbackReason).toBeTruthy();
      } finally {
        server.stop();
      }
    },
    { timeout: HTTP3_TEST_MS }
  );
});
