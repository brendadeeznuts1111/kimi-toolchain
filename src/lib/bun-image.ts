/**
 * bun-image.ts — Bun.Image helpers (v1.3.14+).
 *
 * Platform backends: JPEG/PNG/WebP are portable; HEIC/AVIF use OS codecs on
 * macOS (ImageIO) and Windows (WIC). Linux rejects system formats with
 * ERR_IMAGE_FORMAT_UNSUPPORTED. AVIF encode on macOS requires Apple Silicon M3+.
 *
 * Geometry backend: "system" (Accelerate vImage / WIC) on macOS/Windows;
 * "bun" (Highway SIMD) on Linux. Force "bun" for byte-identical output
 * across platforms (golden-image tests).
 *
 * Terminals: pipelines are lazy until `.bytes()`, `.blob()`, etc. are awaited.
 * Dashboard encode uses `await … .blob()` then caches `Uint8Array` for `/api/thumbnail`.
 * `.write()` terminal accepts path / Bun.file() / Bun.s3() / fd — see dashboard-thumbnails.md Terminals
 * CLI uses .blob() + standalone Bun.write instead.
 *
 * @see {@link BUN_IMAGE_DOCS_URL}
 * @see {@link BUN_IMAGE_TERMINALS_URL}
 * @see {@link BUN_IMAGE_PLACEHOLDERS_URL}
 * @see {@link BUN_IMAGE_BACKENDS_URL}
 */

export const BUN_IMAGE_DOCS_URL = "https://bun.com/docs/runtime/image";
export const BUN_IMAGE_TERMINALS_URL = `${BUN_IMAGE_DOCS_URL}#terminals`;
export const BUN_IMAGE_PLACEHOLDERS_URL = `${BUN_IMAGE_DOCS_URL}#placeholders`;
export const BUN_IMAGE_BACKENDS_URL = `${BUN_IMAGE_DOCS_URL}#platform-backends`;
export const BUN_IMAGE_METADATA_URL = `${BUN_IMAGE_DOCS_URL}#metadata`;

export const DASHBOARD_THUMB_WIDTH = 320;
export const DASHBOARD_THUMB_HEIGHT = 180;

/** Input sources Bun.Image accepts (matches the Bun native constructor). */
export type ImageInput = string | Uint8Array | ArrayBuffer | Blob;

/** Resize filter kernels supported by Bun.Image.resize(). */
export type DashboardThumbnailResizeFilter =
  | "nearest"
  | "box"
  | "bilinear"
  | "cubic"
  | "mitchell"
  | "lanczos2"
  | "lanczos3"
  | "mks2013"
  | "mks2021";

const TINY_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
  ),
  (c) => c.charCodeAt(0)
);

export type DashboardThumbnailFormat = "webp" | "avif" | "jpeg" | "png";
export type DashboardWebViewShell = "serve" | "webview" | "automation";
export type BunImageSystemPlatform = "linux" | "macos" | "windows" | "other";
export type BunImageBackend = "bun" | "system";

/** True when Bun.Image is available in this runtime. */
export function bunImageSupported(): boolean {
  return typeof Bun.Image === "function";
}

// ── Backend control ──────────────────────────────────────────────────

const PLATFORM_DEFAULT_BACKEND: BunImageBackend = process.platform === "linux" ? "bun" : "system";

/**
 * Get the current Bun.Image geometry backend.
 * "system" on macOS/Windows (Accelerate vImage / WIC), "bun" on Linux (Highway SIMD).
 */
export function getBunImageBackend(): BunImageBackend {
  if (!bunImageSupported()) return "bun";
  const backend = (Bun.Image as { backend?: string }).backend;
  return backend === "system" ? "system" : "bun";
}

/**
 * Force a specific Bun.Image backend.
 * - "bun" — portable Highway SIMD path (byte-identical output across platforms).
 * - "system" — OS-accelerated path (macOS Accelerate vImage, Windows WIC).
 *
 * Use "bun" for golden-image tests where encoded bytes must match across
 * macOS, Linux, and Windows.
 */
export function setBunImageBackend(backend: BunImageBackend): void {
  if (!bunImageSupported()) return;
  (Bun.Image as { backend: string }).backend = backend;
}

/** Restore the platform-appropriate default backend. */
export function resetBunImageBackend(): void {
  setBunImageBackend(PLATFORM_DEFAULT_BACKEND);
}

/** Bun.Image platform bucket for system-backend format availability. */
export function bunImageSystemFormatPlatform(): BunImageSystemPlatform {
  if (process.platform === "linux") return "linux";
  if (process.platform === "darwin") return "macos";
  if (process.platform === "win32") return "windows";
  return "other";
}

/** HEIC/AVIF unavailable on this machine (per platform backends table). */
export function isImageFormatUnsupportedError(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { code?: string }).code === "ERR_IMAGE_FORMAT_UNSUPPORTED"
  );
}

let avifEncodeCached: boolean | undefined;

/**
 * Probe AVIF encode once — macOS M3+ or Windows with AV1 extensions.
 * Intel Mac and M1/M2 decode AVIF but reject encode.
 *
 * @see {@link BUN_IMAGE_TERMINALS_URL} — uses `await … .bytes()` terminal
 * Consumer: `GET /api/meta` → `meta.thumbnailFormats.avif` in herdr-dashboard-server.ts
 */
export async function probeBunImageAvifEncode(): Promise<boolean> {
  if (avifEncodeCached !== undefined) return avifEncodeCached;
  if (!bunImageSupported() || bunImageSystemFormatPlatform() === "linux") {
    avifEncodeCached = false;
    return false;
  }
  try {
    await new Bun.Image(TINY_PNG).resize(1, 1).avif({ quality: 50 }).bytes();
    avifEncodeCached = true;
  } catch {
    avifEncodeCached = false;
  }
  return avifEncodeCached;
}

/** True when Accept negotiation may try AVIF (runtime fallback handles M1/M2). */
export function bunImageAvifNegotiable(): boolean {
  if (!bunImageSupported()) return false;
  const platform = bunImageSystemFormatPlatform();
  return platform === "macos" || platform === "windows";
}

/** Default maxPixels guard (~16.8 MP) — blocks decompression bombs. */
export const DASHBOARD_THUMBNAIL_MAX_PIXELS = 4096 * 4096;

export interface DashboardThumbnailOptions {
  width?: number;
  height?: number;
  quality?: number;
  format?: DashboardThumbnailFormat;
  /** Resize filter kernel (default: lanczos3). */
  filter?: DashboardThumbnailResizeFilter;
  /** Reject input if width×height > this (default: 4096×4096). */
  maxPixels?: number;
  /** Emit indexed (color-type 3) PNG — 3–5× smaller for screenshots. */
  palette?: boolean;
  /** Palette size (2–256, default 256). Only when palette is true. */
  colors?: number;
  /** Floyd–Steinberg dither (default true). Only when palette is true. */
  dither?: boolean;
}

export interface DashboardThumbnailFeedOptions {
  shell?: DashboardWebViewShell;
  screenshotProvider?: unknown;
  hasScreenshot?: boolean;
}

/** True when a live screenshot feed or cache can satisfy `/api/thumbnail`. */
export function dashboardThumbnailFeedsActive(
  options: DashboardThumbnailFeedOptions = {}
): boolean {
  if (options.hasScreenshot) return true;
  if (options.screenshotProvider) return true;
  const shell = options.shell ?? "serve";
  return shell === "webview" || shell === "automation";
}

/** Pick AVIF or WebP from an HTTP Accept header (prefers AVIF on macOS/Windows). */
export function negotiateDashboardThumbnailFormat(
  accept: string | null | undefined
): DashboardThumbnailFormat {
  if (!accept) return "webp";
  const lower = accept.toLowerCase();
  if (bunImageAvifNegotiable() && lower.includes("image/avif")) return "avif";
  return "webp";
}

// ── Image metadata ──────────────────────────────────────────────────

/** Bun.Image metadata shape (subset — Bun returns additional fields). */
export interface ImageMetadata {
  width: number;
  height: number;
  format: string;
}

/**
 * Read image dimensions and format without decoding pixels.
 * Returns null when Bun.Image is unavailable or the input can't be parsed.
 *
 * @see {@link BUN_IMAGE_METADATA_URL}
 */
export async function imageMetadata(input: ImageInput): Promise<ImageMetadata | null> {
  if (!bunImageSupported()) return null;
  try {
    const meta = await new Bun.Image(input).metadata();
    return { width: meta.width, height: meta.height, format: meta.format };
  } catch {
    return null;
  }
}

/** Build resize + encode chain; pass `maxPixels` via constructor options (Input guard). */
function dashboardThumbnailPipeline(
  png: Uint8Array,
  options: Required<Pick<DashboardThumbnailOptions, "width" | "height" | "quality">> & {
    format: DashboardThumbnailFormat;
    filter?: DashboardThumbnailResizeFilter;
    maxPixels?: number;
    palette?: boolean;
    colors?: number;
    dither?: boolean;
  }
): Bun.Image {
  const imageOptions: { maxPixels?: number } = {};
  if (options.maxPixels !== undefined) {
    imageOptions.maxPixels = options.maxPixels;
  }
  const resized = new Bun.Image(png, imageOptions).resize(options.width, options.height, {
    fit: "inside",
    withoutEnlargement: true,
    filter: options.filter,
  });
  switch (options.format) {
    case "avif":
      return resized.avif({ quality: options.quality });
    case "jpeg":
      return resized.jpeg({ quality: options.quality });
    case "png":
      if (options.palette) {
        return resized.png({
          palette: true,
          colors: options.colors,
          dither: options.dither,
        });
      }
      return resized.png();
    default:
      return resized.webp({ quality: options.quality });
  }
}

/** Primary encode path — awaits `.blob()` terminal (off JS thread). Used by `/api/thumbnail` miss path. */
async function dashboardThumbnailBlob(
  png: Uint8Array,
  options: Required<Pick<DashboardThumbnailOptions, "width" | "height" | "quality">> & {
    format: DashboardThumbnailFormat;
    filter?: DashboardThumbnailResizeFilter;
    maxPixels?: number;
    palette?: boolean;
    colors?: number;
    dither?: boolean;
  }
): Promise<Blob> {
  try {
    return await dashboardThumbnailPipeline(png, options).blob();
  } catch (e: unknown) {
    if (options.format === "avif" && isImageFormatUnsupportedError(e)) {
      return dashboardThumbnailPipeline(png, { ...options, format: "webp" }).blob();
    }
    throw e;
  }
}

/**
 * Resize a dashboard PNG capture to encoded thumbnail bytes (`fit: inside`).
 *
 * @see {@link BUN_IMAGE_TERMINALS_URL} — `dashboardThumbnailBlob()` → `.blob()`
 * Consumer: herdr-dashboard-server.ts `GET /api/thumbnail` (TtlCache miss)
 */
export async function dashboardThumbnailBytes(
  png: Uint8Array,
  options: DashboardThumbnailOptions = {}
): Promise<Uint8Array | null> {
  if (!bunImageSupported()) return null;

  const width = options.width ?? DASHBOARD_THUMB_WIDTH;
  const height = options.height ?? DASHBOARD_THUMB_HEIGHT;
  const quality = options.quality ?? 80;
  const format = options.format ?? "webp";
  const filter = options.filter;
  const maxPixels = options.maxPixels;
  const palette = options.palette;
  const colors = options.colors;
  const dither = options.dither;

  const blob = await dashboardThumbnailBlob(png, {
    width,
    height,
    quality,
    format,
    filter,
    maxPixels,
    palette,
    colors,
    dither,
  });
  return new Uint8Array(await blob.arrayBuffer());
}

/** WebP shorthand — CLI `--thumbnail` and runHerdrDashboardAutomation disk output. */
export async function dashboardWebpThumbnail(
  png: Uint8Array,
  options: DashboardThumbnailOptions = {}
): Promise<Uint8Array | null> {
  return dashboardThumbnailBytes(png, { ...options, format: "webp" });
}

/**
 * Encoded thumbnail as HTTP response (await `.blob()` keeps encode off the JS thread).
 *
 * @see {@link BUN_IMAGE_TERMINALS_URL}
 * @see {@link BUN_IMAGE_DOCS_URL} — Bun.serve integration (prefer pre-awaited bytes in routes)
 * Available helper; server uses `dashboardThumbnailBytes` + cache for hit/miss headers.
 */
export async function dashboardThumbnailResponse(
  png: Uint8Array,
  options: DashboardThumbnailOptions = {}
): Promise<Response> {
  const width = options.width ?? DASHBOARD_THUMB_WIDTH;
  const height = options.height ?? DASHBOARD_THUMB_HEIGHT;
  const quality = options.quality ?? 80;
  const format = options.format ?? "webp";
  const filter = options.filter;
  const maxPixels = options.maxPixels;
  const palette = options.palette;
  const colors = options.colors;
  const dither = options.dither;
  const blob = await dashboardThumbnailBlob(png, {
    width,
    height,
    quality,
    format,
    filter,
    maxPixels,
    palette,
    colors,
    dither,
  });
  return new Response(blob, { headers: { "cache-control": "no-store" } });
}

/**
 * LQIP placeholder data URL for an image path, bytes, or BunFile (ThumbHash).
 *
 * @see {@link BUN_IMAGE_PLACEHOLDERS_URL}
 * Consumer: herdr-dashboard-server.ts `GET /api/meta` → `meta.placeholder`
 */
export async function imagePlaceholderDataUrl(input: ImageInput): Promise<string | null> {
  if (!bunImageSupported()) return null;
  return new Bun.Image(input).placeholder();
}

// ── Thumbnail cache key ──────────────────────────────────────────────

/**
 * Derive a deterministic cache key from source bytes + requested params.
 * The source hash ensures invalidation when the screenshot changes;
 * param encoding prevents collisions across size/format/quality combos.
 */
export function thumbnailCacheKey(
  sourcePng: Uint8Array,
  width: number,
  height: number,
  quality: number,
  format: DashboardThumbnailFormat
): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(sourcePng);
  hasher.update(`:${width}x${height}:q${quality}:${format}`);
  return hasher.digest("hex");
}

/** MIME type for a thumbnail format. */
export function thumbnailFormatMime(format: DashboardThumbnailFormat): string {
  switch (format) {
    case "avif":
      return "image/avif";
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    default:
      return "image/webp";
  }
}
