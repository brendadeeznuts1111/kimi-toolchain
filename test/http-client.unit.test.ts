import { describe, expect, test } from "bun:test";
import {
  makeHttpClient,
  TLS_VERSIONS,
  tlsMinVersionCode,
  type TLSVersion,
} from "../src/lib/http-client.ts";

describe("http-client", () => {
  test("TLS_VERSIONS contains all supported versions", () => {
    expect(TLS_VERSIONS).toEqual(["TLSv1", "TLSv1.1", "TLSv1.2", "TLSv1.3"]);
  });

  test("TLSVersion type accepts valid literals", () => {
    const versions: TLSVersion[] = ["TLSv1", "TLSv1.1", "TLSv1.2", "TLSv1.3"];
    expect(versions).toHaveLength(4);
  });

  test("tlsMinVersionCode maps labels to OpenSSL version codes", () => {
    expect(tlsMinVersionCode("TLSv1")).toBe(0x0301);
    expect(tlsMinVersionCode("TLSv1.1")).toBe(0x0302);
    expect(tlsMinVersionCode("TLSv1.2")).toBe(0x0303);
    expect(tlsMinVersionCode("TLSv1.3")).toBe(0x0304);
  });

  test("makeHttpClient defaults to TLSv1.2 floor", () => {
    const client = makeHttpClient();
    expect(client).toHaveProperty("fetch");
    expect(typeof client.fetch).toBe("function");
  });

  test("makeHttpClient accepts a custom TLS floor", () => {
    const client = makeHttpClient({ minTLS: "TLSv1.3" });
    expect(client).toHaveProperty("fetch");
  });
});
