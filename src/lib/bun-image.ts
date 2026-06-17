/**
 * bun-image.ts — Bun.Image helpers (v1.3.14+).
 *
 * @see https://bun.sh/docs/runtime/image
 */

export const DASHBOARD_THUMB_WIDTH = 320;
export const DASHBOARD_THUMB_HEIGHT = 180;

/** True when Bun.Image is available in this runtime. */
export function bunImageSupported(): boolean {
  return typeof Bun.Image === "function";
}

export interface DashboardThumbnailOptions {
  width?: number;
  height?: number;
  quality?: number;
}

/** Resize a dashboard PNG capture to a WebP thumbnail (`fit: inside`). */
export async function dashboardWebpThumbnail(
  png: Uint8Array,
  options: DashboardThumbnailOptions = {}
): Promise<Uint8Array | null> {
  if (!bunImageSupported()) return null;

  const width = options.width ?? DASHBOARD_THUMB_WIDTH;
  const height = options.height ?? DASHBOARD_THUMB_HEIGHT;
  const quality = options.quality ?? 80;

  return new Bun.Image(png)
    .resize(width, height, { fit: "inside", withoutEnlargement: true })
    .webp({ quality })
    .bytes();
}

/** LQIP placeholder data URL for a raster image path or bytes. */
export async function imagePlaceholderDataUrl(input: string | Uint8Array): Promise<string | null> {
  if (!bunImageSupported()) return null;
  return new Bun.Image(input).placeholder("dataurl");
}
