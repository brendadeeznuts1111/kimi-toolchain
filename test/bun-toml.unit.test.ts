/**
 * Bun.TOML correctness regression test.
 *
 * Bun natively parses TOML config files (bunfig.toml, dx.config.toml).
 */
import { describe, expect, test } from "bun:test";

const TOML_CONFIG = `
[install]
frozenLockfile = true
linker = "isolated"

[define]
KIMI_TUNING_SET_VERSION = "1.4.4"

[[hooks]]
pattern = "*"
`;

describe("bun-toml", () => {
  test("Bun.TOML is available", () => {
    expect(typeof Bun.TOML).toBe("object");
    expect(typeof Bun.TOML.parse).toBe("function");
  });

  test("Bun.TOML.parse parses sections and arrays", () => {
    const parsed = Bun.TOML.parse(TOML_CONFIG);
    expect(parsed.install.frozenLockfile).toBe(true);
    expect(parsed.install.linker).toBe("isolated");
    expect(parsed.define.KIMI_TUNING_SET_VERSION).toBe("1.4.4");
    expect(Array.isArray(parsed.hooks)).toBe(true);
  });
});
