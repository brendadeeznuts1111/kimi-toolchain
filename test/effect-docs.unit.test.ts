import { describe, expect, test } from "bun:test";
import {
  EFFECT_DOCS_URL,
  EFFECT_ENSUREING_DOC_URL,
  EFFECT_GEN_DOC_URL,
  EFFECT_LAYER_DOC_URL,
  EFFECT_RUNTIME_DOC_URL,
  EFFECT_TAGGED_ERROR_DOC_URL,
} from "../src/lib/effect-docs.ts";

describe("effect-docs", () => {
  test("Effect doc URLs use effect.website host", () => {
    for (const url of [
      EFFECT_DOCS_URL,
      EFFECT_GEN_DOC_URL,
      EFFECT_TAGGED_ERROR_DOC_URL,
      EFFECT_LAYER_DOC_URL,
      EFFECT_RUNTIME_DOC_URL,
      EFFECT_ENSUREING_DOC_URL,
    ]) {
      expect(new URL(url).hostname).toBe("effect.website");
    }
  });

  test("bun-install-config re-exports Effect doc URLs", async () => {
    const install = await import("../src/lib/bun-install-config.ts");
    expect(install.EFFECT_DOCS_URL).toBe(EFFECT_DOCS_URL);
    expect(install.EFFECT_GEN_DOC_URL).toBe(EFFECT_GEN_DOC_URL);
  });
});