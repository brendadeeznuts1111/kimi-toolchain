import { describe, expect, test } from "bun:test";
import { detectConfigFormat, jsoncSupported, loadConfig } from "../src/lib/config-loader.ts";
import { safeJsonc } from "../src/lib/safe-parse.ts";

describe("config-loader", () => {
  test("detectConfigFormat maps jsonc extension", () => {
    expect(detectConfigFormat("wrangler.jsonc")).toBe("jsonc");
    expect(detectConfigFormat("tsconfig.json")).toBe("json");
    expect(detectConfigFormat("dx.config.toml")).toBe("toml");
  });

  test("safeJsonc parses comments and trailing commas", () => {
    expect(jsoncSupported()).toBe(true);
    const parsed = safeJsonc<{ host: string; port: number }>(
      `{
        // line comment
        "host": "localhost",
        "port": 5432 }`,
      { host: "", port: 0 }
    );
    expect(parsed.host).toBe("localhost");
    expect(parsed.port).toBe(5432);
  });

  test("loadConfig delegates jsonc format to safeJsonc", () => {
    const parsed = loadConfig<{ name: string }>(
      `{
        "name": "worker", // wrangler name
      }`,
      "jsonc",
      { name: "" }
    );
    expect(parsed.name).toBe("worker");
  });
});
