import { describe, expect, test, afterEach } from "bun:test";
import {
  bunImageAvifNegotiable,
  bunImageSupported,
  bunImageSystemFormatPlatform,
  dashboardThumbnailFeedsActive,
  dashboardThumbnailResponse,
  dashboardThumbnailBytes,
  dashboardWebpThumbnail,
  getBunImageBackend,
  imageMetadata,
  isImageFormatUnsupportedError,
  negotiateDashboardThumbnailFormat,
  probeBunImageAvifEncode,
  resetBunImageBackend,
  setBunImageBackend,
  thumbnailCacheKey,
  thumbnailFormatMime,
  DASHBOARD_THUMB_HEIGHT,
  DASHBOARD_THUMB_WIDTH,
  type DashboardThumbnailResizeFilter,
  DASHBOARD_THUMBNAIL_MAX_PIXELS,
} from "../src/lib/bun-image.ts";
import { webViewScreenshotBytes } from "../src/lib/herdr-dashboard-automation.ts";
import { webViewSupported } from "../src/lib/webview-console.ts";

describe("bun-image", () => {
  test("DASHBOARD_THUMB dimensions are 16:9 friendly", () => {
    expect(DASHBOARD_THUMB_WIDTH / DASHBOARD_THUMB_HEIGHT).toBeCloseTo(16 / 9, 1);
  });

  test("dashboardThumbnailFeedsActive is false for serve-only shell", () => {
    expect(dashboardThumbnailFeedsActive({ shell: "serve" })).toBe(false);
    expect(dashboardThumbnailFeedsActive({ shell: "webview" })).toBe(true);
    expect(dashboardThumbnailFeedsActive({ shell: "serve", hasScreenshot: true })).toBe(true);
  });

  test("negotiateDashboardThumbnailFormat prefers avif on macOS/Windows", () => {
    const format = negotiateDashboardThumbnailFormat("image/avif,image/webp,*/*");
    expect(format).toBe(bunImageAvifNegotiable() ? "avif" : "webp");
  });

  test("probeBunImageAvifEncode is false on Linux", async () => {
    if (bunImageSystemFormatPlatform() !== "linux") return;
    expect(await probeBunImageAvifEncode()).toBe(false);
  });

  test("isImageFormatUnsupportedError matches Bun docs error code", () => {
    expect(isImageFormatUnsupportedError({ code: "ERR_IMAGE_FORMAT_UNSUPPORTED" })).toBe(true);
    expect(isImageFormatUnsupportedError(new Error("nope"))).toBe(false);
  });

  test("dashboardThumbnailResponse sets image content-type", async () => {
    if (!bunImageSupported()) return;
    const tinyPng = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
      ),
      (c) => c.charCodeAt(0)
    );
    const res = await dashboardThumbnailResponse(tinyPng, {
      width: 160,
      height: 90,
      quality: 75,
    });
    expect(res.headers.get("content-type")).toBe("image/webp");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.byteLength).toBeGreaterThan(10);
  });

  test("dashboardWebpThumbnail shrinks a WebView PNG capture", async () => {
    if (!webViewSupported() || !bunImageSupported()) return;

    await using view = new Bun.WebView({ width: 640, height: 360 });
    await view.navigate("data:text/html,<h1 style='color:white;background:#111'>thumb</h1>");
    await Bun.sleep(200);

    const png = await webViewScreenshotBytes(view);
    const thumb = await dashboardWebpThumbnail(png);
    expect(thumb).not.toBeNull();
    expect(thumb!.byteLength).toBeGreaterThan(100);
    expect(thumb!.byteLength).toBeLessThan(png.byteLength);
  }, 30_000);
});

// ── Backend control + golden-image workflow ──────────────────────────

describe("bun-image backend", () => {
  afterEach(() => {
    resetBunImageBackend();
  });

  test("getBunImageBackend returns platform default", () => {
    const backend = getBunImageBackend();
    expect(["bun", "system"]).toContain(backend);
  });

  test("setBunImageBackend switches to bun and back", () => {
    setBunImageBackend("bun");
    expect(getBunImageBackend()).toBe("bun");
    setBunImageBackend("system");
    expect(getBunImageBackend()).toBe("system");
    resetBunImageBackend();
    expect(["bun", "system"]).toContain(getBunImageBackend());
  });

  test("bun backend produces deterministic bytes (golden-image workflow)", async () => {
    if (!bunImageSupported()) return;

    setBunImageBackend("bun");

    const tinyPng = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
      ),
      (c) => c.charCodeAt(0)
    );

    // Encode twice; Highway SIMD path must produce identical bytes
    const a = await dashboardThumbnailBytes(tinyPng, {
      width: 8,
      height: 8,
      quality: 80,
      format: "webp",
    });
    const b = await dashboardThumbnailBytes(tinyPng, {
      width: 8,
      height: 8,
      quality: 80,
      format: "webp",
    });
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!).toEqual(b!);

    // JPEG should also be deterministic
    const jpegA = await dashboardThumbnailBytes(tinyPng, {
      width: 8,
      height: 8,
      quality: 75,
      format: "jpeg",
    });
    const jpegB = await dashboardThumbnailBytes(tinyPng, {
      width: 8,
      height: 8,
      quality: 75,
      format: "jpeg",
    });
    expect(jpegA).not.toBeNull();
    expect(jpegA!).toEqual(jpegB!);
  });
});

describe("thumbnail cache key", () => {
  const png1 = Uint8Array.of(1, 2, 3);
  const png2 = Uint8Array.of(4, 5, 6);

  test("same inputs produce same key", () => {
    const a = thumbnailCacheKey(png1, 320, 180, 80, "webp");
    const b = thumbnailCacheKey(png1, 320, 180, 80, "webp");
    expect(a).toBe(b);
  });

  test("different source produces different key", () => {
    const a = thumbnailCacheKey(png1, 320, 180, 80, "webp");
    const b = thumbnailCacheKey(png2, 320, 180, 80, "webp");
    expect(a).not.toBe(b);
  });

  test("different params produce different keys", () => {
    const a = thumbnailCacheKey(png1, 320, 180, 80, "webp");
    const b = thumbnailCacheKey(png1, 160, 90, 80, "webp");
    const c = thumbnailCacheKey(png1, 320, 180, 60, "webp");
    const d = thumbnailCacheKey(png1, 320, 180, 80, "jpeg");
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
  });
});

describe("thumbnail format mime", () => {
  test("maps formats to correct MIME types", () => {
    expect(thumbnailFormatMime("webp")).toBe("image/webp");
    expect(thumbnailFormatMime("avif")).toBe("image/avif");
    expect(thumbnailFormatMime("jpeg")).toBe("image/jpeg");
    expect(thumbnailFormatMime("png")).toBe("image/png");
  });
});

// ── Image metadata ───────────────────────────────────────────────────

describe("imageMetadata", () => {
  test("returns dimensions and format for valid PNG bytes", async () => {
    if (!bunImageSupported()) return;

    const tinyPng = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
      ),
      (c) => c.charCodeAt(0)
    );

    const meta = await imageMetadata(tinyPng);
    expect(meta).not.toBeNull();
    expect(meta!.width).toBe(1);
    expect(meta!.height).toBe(1);
    expect(meta!.format).toBe("png");
  });

  test("returns null for invalid input", async () => {
    if (!bunImageSupported()) return;
    const meta = await imageMetadata(Uint8Array.of(0, 1, 2, 3));
    expect(meta).toBeNull();
  });

  test("returns null when Bun.Image is unavailable", async () => {
    // imageMetadata guards on bunImageSupported() internally
    const meta = await imageMetadata(Uint8Array.of(0));
    if (!bunImageSupported()) {
      expect(meta).toBeNull();
    }
  });
});

// ── Resize filter ────────────────────────────────────────────────────

describe("thumbnail resize filter", () => {
  test("filter param flows through to pipeline without error", async () => {
    if (!bunImageSupported()) return;

    const tinyPng = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
      ),
      (c) => c.charCodeAt(0)
    );

    const filters: DashboardThumbnailResizeFilter[] = [
      "nearest",
      "box",
      "bilinear",
      "cubic",
      "mitchell",
      "lanczos2",
      "lanczos3",
      "mks2013",
      "mks2021",
    ];

    for (const filter of filters) {
      const bytes = await dashboardThumbnailBytes(tinyPng, {
        width: 8,
        height: 8,
        quality: 80,
        format: "webp",
        filter,
      });
      expect(bytes).not.toBeNull();
      expect(bytes!.byteLength).toBeGreaterThan(10);
    }
  });

  test("different filters may produce different output", async () => {
    if (!bunImageSupported()) return;

    setBunImageBackend("bun");

    const tinyPng = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
      ),
      (c) => c.charCodeAt(0)
    );

    // nearest vs lanczos3 on a 1×1 image should produce identical results
    // since there's nothing to interpolate — but the pipeline shouldn't crash
    const a = await dashboardThumbnailBytes(tinyPng, {
      width: 8,
      height: 8,
      quality: 80,
      format: "png",
      filter: "nearest",
    });
    const b = await dashboardThumbnailBytes(tinyPng, {
      width: 8,
      height: 8,
      quality: 80,
      format: "png",
      filter: "lanczos3",
    });

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    // Both should be valid PNG outputs
    expect(a!.byteLength).toBeGreaterThan(10);
    expect(b!.byteLength).toBeGreaterThan(10);
  });

  afterEach(() => {
    resetBunImageBackend();
  });
});

// ── maxPixels guard ──────────────────────────────────────────────────

describe("maxPixels guard", () => {
  test("valid thumbnail within limit succeeds", async () => {
    if (!bunImageSupported()) return;

    const tinyPng = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
      ),
      (c) => c.charCodeAt(0)
    );

    // 1×1 is well within any reasonable limit
    const bytes = await dashboardThumbnailBytes(tinyPng, {
      width: 8,
      height: 8,
      maxPixels: 64,
      format: "webp",
    });
    expect(bytes).not.toBeNull();
    expect(bytes!.byteLength).toBeGreaterThan(10);
  });

  test("DASHBOARD_THUMBNAIL_MAX_PIXELS is a reasonable default", () => {
    // 4096 × 4096 = 16.8 MP — matches Sharp's approach
    expect(DASHBOARD_THUMBNAIL_MAX_PIXELS).toBe(4096 * 4096);
  });

  test("maxPixels flows through without error on all formats", async () => {
    if (!bunImageSupported()) return;

    const tinyPng = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
      ),
      (c) => c.charCodeAt(0)
    );

    for (const fmt of ["webp", "jpeg", "png"] as const) {
      const bytes = await dashboardThumbnailBytes(tinyPng, {
        width: 8,
        height: 8,
        maxPixels: 64,
        format: fmt,
      });
      expect(bytes).not.toBeNull();
      expect(bytes!.byteLength).toBeGreaterThan(10);
    }
  });
});

// ── Indexed PNG ──────────────────────────────────────────────────────

describe("indexed PNG (palette)", () => {
  test("palette PNG produces valid output", async () => {
    if (!bunImageSupported()) return;

    const tinyPng = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
      ),
      (c) => c.charCodeAt(0)
    );

    const bytes = await dashboardThumbnailBytes(tinyPng, {
      width: 8,
      height: 8,
      format: "png",
      palette: true,
      colors: 64,
      dither: false,
    });
    expect(bytes).not.toBeNull();
    expect(bytes!.byteLength).toBeGreaterThan(10);
  });

  test("palette is ignored for non-PNG formats", async () => {
    if (!bunImageSupported()) return;

    const tinyPng = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
      ),
      (c) => c.charCodeAt(0)
    );

    // palette=true with webp format should not crash — it's just ignored
    const bytes = await dashboardThumbnailBytes(tinyPng, {
      width: 8,
      height: 8,
      format: "webp",
      palette: true,
      colors: 64,
    });
    expect(bytes).not.toBeNull();
    expect(bytes!.byteLength).toBeGreaterThan(10);
  });
});
