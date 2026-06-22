import { describe, expect, test } from "bun:test";
import { resolveFetchProxyMode, shouldBypassProxy } from "../src/lib/network-config.ts";

describe("doctor-network-audit", () => {
  test("shouldBypassProxy honors exact and suffix NO_PROXY rules", () => {
    const env = { NO_PROXY: "localhost,.example.com" };
    expect(shouldBypassProxy("localhost", env)).toBe(true);
    expect(shouldBypassProxy("api.example.com", env)).toBe(true);
    expect(shouldBypassProxy("other.com", env)).toBe(false);
  });

  test("shouldBypassProxy treats leading-dot rules as domain suffixes", () => {
    const env = { no_proxy: ".staging.example.com" };
    expect(shouldBypassProxy("api.staging.example.com", env)).toBe(true);
    expect(shouldBypassProxy("staging.example.com", env)).toBe(true);
    expect(shouldBypassProxy("example.com", env)).toBe(false);
  });

  test("resolveFetchProxyMode returns direct when bypass applies", () => {
    const env = { NO_PROXY: "127.0.0.1" };
    expect(resolveFetchProxyMode("http://127.0.0.1:3000/health", env)).toBe("direct");
    expect(resolveFetchProxyMode("https://api.github.com", env)).toBe("proxy");
  });

  test("shouldBypassProxy handles IPv6 literals", () => {
    const env = { NO_PROXY: "::1" };
    expect(shouldBypassProxy("::1", env)).toBe(true);
    expect(shouldBypassProxy("[::1]", env)).toBe(true);
    expect(resolveFetchProxyMode("http://[::1]:3000/health", env)).toBe("direct");
    expect(shouldBypassProxy("2001:db8::1", env)).toBe(false);
  });
});
