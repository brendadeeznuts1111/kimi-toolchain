import { describe, expect, test } from "bun:test";
import {
  buildHerdrDashboardEffectImageMeta,
  effectImageMarkBytes,
  effectImageMetadata,
  EFFECT_IMAGE_SAMPLE_PNG,
} from "../src/lib/herdr-dashboard/effect-image.ts";
import { bunImageSupported } from "../src/lib/bun-image.ts";

describe("herdr-dashboard-effect-image", () => {
  test("SAMPLE_PNG is decodable apiImage sample", () => {
    expect(EFFECT_IMAGE_SAMPLE_PNG.byteLength).toBeGreaterThan(60);
  });

  test("metadata reads 2x2 sample", async () => {
    if (!bunImageSupported()) return;
    const meta = await effectImageMetadata();
    expect(meta?.width).toBe(2);
    expect(meta?.height).toBe(2);
  });

  test("mark bytes encode when Bun.Image is available", async () => {
    if (!bunImageSupported()) return;
    const bytes = await effectImageMarkBytes();
    expect(bytes).not.toBeNull();
    expect((bytes?.byteLength ?? 0) > 0).toBe(true);
  });

  test("buildHerdrDashboardEffectImageMeta exposes mark path", async () => {
    const meta = await buildHerdrDashboardEffectImageMeta();
    expect(meta.markPath).toBe("/api/bun-mark");
    expect(meta.effectImagePath).toBe("/api/effect-image");
    expect(meta.source).toContain("effect/image/processor.ts");
    expect(meta.runtimeCapabilityKey).toBe("bunImage");
    expect(meta.docsUrl).toBe("https://bun.com/docs/runtime/image");
    if (bunImageSupported()) {
      expect(meta.available).toBe(true);
      expect(meta.metadata?.width).toBe(2);
    }
  });
});
