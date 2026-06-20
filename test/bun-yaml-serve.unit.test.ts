/**
 * Bun.YAML and Bun.serve correctness regression tests.
 */
import { describe, expect, test } from "bun:test";

const YAML_CONFIG = `
install:
  frozenLockfile: true
  linker: isolated
hooks:
  - pattern: "*"
`;

describe("bun-yaml", () => {
  test("Bun.YAML is available", () => {
    expect(typeof Bun.YAML).toBe("object");
    expect(typeof Bun.YAML.parse).toBe("function");
  });

  test("Bun.YAML.parse parses sections and arrays", () => {
    const parsed = Bun.YAML.parse(YAML_CONFIG) as {
      install: { frozenLockfile: boolean; linker: string };
      hooks: unknown[];
    };
    expect(parsed.install.frozenLockfile).toBe(true);
    expect(parsed.install.linker).toBe("isolated");
    expect(Array.isArray(parsed.hooks)).toBe(true);
  });
});

describe("bun-serve", () => {
  test("Bun.serve is available", () => {
    expect(typeof Bun.serve).toBe("function");
  });

  test("Bun.serve starts and stops cleanly", async () => {
    let served = false;
    const server = Bun.serve({
      port: 0,
      fetch() {
        served = true;
        return new Response("ok");
      },
    });
    try {
      const res = await fetch(`http://localhost:${server.port}`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok");
      expect(served).toBe(true);
    } finally {
      server.stop(true);
    }
  });
});
