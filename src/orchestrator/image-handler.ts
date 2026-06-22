/**
 * image-handler.ts — Orchestrator-native image pipeline using Bun.Image.
 *
 * Provides thumbnail generation and placeholder responses that can be wired
 * into the herdr orchestrator's HTTP/dashboard paths or report rendering.
 */
import {
  dashboardThumbnailResponse,
  imagePlaceholderDataUrl,
  type DashboardThumbnailFormat,
} from "../lib/bun-image.ts";

/**
 * Serve a WebP thumbnail of an image file.
 *
 * Example route usage in Bun.serve:
 *   "/api/thumbnail": async (req) => {
 *     const path = new URL(req.url).searchParams.get("path");
 *     return path ? serveThumbnail(path) : new Response("missing path", { status: 400 });
 *   }
 */
export async function serveThumbnail(
  filePath: string,
  width = 320,
  height = 180,
  format: DashboardThumbnailFormat = "webp"
): Promise<Response> {
  const bytes = await Bun.file(filePath).bytes();
  return dashboardThumbnailResponse(bytes, { width, height, format });
}

/**
 * Generate a tiny inline placeholder data URL for blur-up image loading.
 *
 * Returns null if Bun.Image is not available or the input is unsupported.
 */
export async function servePlaceholder(
  input: string | Uint8Array | ArrayBuffer | Blob
): Promise<string | null> {
  return imagePlaceholderDataUrl(input);
}
