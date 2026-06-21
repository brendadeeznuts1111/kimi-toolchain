/**
 * herdr-dashboard-effect-image.ts — Bun.Image mark for session bar.
 *
 * Mirrors examples/dashboard/src/effect/image/processor.ts (scan → benchmark reference).
 * Serves a always-available WebP mark when WebView screenshots are offline.
 */

import {
  BUN_IMAGE_DOCS_URL,
  bunImageSupported,
  dashboardThumbnailBytes,
  thumbnailFormatMime,
  type ImageMetadata,
} from "./bun-image.ts";

/** Decodable 2×2 PNG from examples/dashboard `apiImage` (resizes for `/api/bun-mark`). */
export const EFFECT_IMAGE_SAMPLE_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAE0lEQVR4nGP4z8DwnwGM/zMwAAAf7gP9NRsAMwAAAABJRU5ErkJggg=="
  ),
  (c) => c.charCodeAt(0)
);

export const EFFECT_IMAGE_MARK_WIDTH = 32;
export const EFFECT_IMAGE_MARK_HEIGHT = 32;

export interface HerdrDashboardEffectImageMeta {
  available: boolean;
  markPath: string;
  effectImagePath: string;
  source: "examples/dashboard/src/effect/image/processor.ts";
  runtimeCapabilityKey: "bunImage";
  docsUrl: typeof BUN_IMAGE_DOCS_URL;
  metadata?: ImageMetadata;
  placeholder?: string;
  error?: string;
}

export async function effectImageMetadata(
  input: Uint8Array = EFFECT_IMAGE_SAMPLE_PNG
): Promise<ImageMetadata | null> {
  if (!bunImageSupported()) return null;
  try {
    return (await new Bun.Image(input).metadata()) as ImageMetadata;
  } catch {
    return null;
  }
}

export async function effectImagePlaceholder(
  input: Uint8Array = EFFECT_IMAGE_SAMPLE_PNG
): Promise<string | null> {
  if (!bunImageSupported()) return null;
  try {
    return await new Bun.Image(input).placeholder();
  } catch {
    return null;
  }
}

export async function effectImageMarkBytes(
  options: { width?: number; height?: number; quality?: number } = {}
): Promise<Uint8Array | null> {
  if (!bunImageSupported()) return null;
  const width = options.width ?? EFFECT_IMAGE_MARK_WIDTH;
  const height = options.height ?? EFFECT_IMAGE_MARK_HEIGHT;
  const quality = options.quality ?? 82;
  try {
    return await dashboardThumbnailBytes(EFFECT_IMAGE_SAMPLE_PNG, {
      width,
      height,
      quality,
      format: "webp",
    });
  } catch {
    return null;
  }
}

export async function buildHerdrDashboardEffectImageMeta(): Promise<HerdrDashboardEffectImageMeta> {
  const base: HerdrDashboardEffectImageMeta = {
    available: bunImageSupported(),
    markPath: "/api/bun-mark",
    effectImagePath: "/api/effect-image",
    source: "examples/dashboard/src/effect/image/processor.ts",
    runtimeCapabilityKey: "bunImage",
    docsUrl: BUN_IMAGE_DOCS_URL,
  };
  if (!bunImageSupported()) {
    return { ...base, error: "Bun.Image unavailable" };
  }
  const [metadata, placeholder] = await Promise.all([
    effectImageMetadata(),
    effectImagePlaceholder(),
  ]);
  return {
    ...base,
    ...(metadata ? { metadata } : {}),
    ...(placeholder ? { placeholder } : {}),
  };
}

export function effectImageMarkMime(): string {
  return thumbnailFormatMime("webp");
}
