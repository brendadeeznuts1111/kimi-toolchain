/**
 * embedded-assets.ts — Binary assets embedded at build time via Bun macros.
 *
 * Assets are read as Uint8Array at BUILD TIME and serialized as base64
 * strings by Bun's macro system. The bundled output contains only the
 * base64 string — zero file I/O at runtime.
 *
 * Usage:
 *   import { shieldIcon, shieldIconDataUri } from "./embedded-assets.ts";
 *   // shieldIcon is a base64 string
 *   // shieldIconDataUri is a ready-to-use data: URI
 */

import { embedAsset } from "./asset-embed-macros.ts" with { type: "macro" };

// ── Embedded Assets (base64 strings at build time) ───────────────────

/** Shield icon SVG as base64-encoded string. */
export const shieldIcon: string = embedAsset("./src/assets/shield.svg");

/** Shield icon as a data: URI ready for use in HTML/CSS. */
export const shieldIconDataUri: string = `data:image/svg+xml;base64,${shieldIcon}`;

// ── Asset Registry ───────────────────────────────────────────────────

export interface EmbeddedAsset {
  name: string;
  base64: string;
  dataUri: string;
  mimeType: string;
}

export const assets: EmbeddedAsset[] = [
  {
    name: "shield",
    base64: shieldIcon,
    dataUri: shieldIconDataUri,
    mimeType: "image/svg+xml",
  },
];

/** Find an embedded asset by name. */
export function getAsset(name: string): EmbeddedAsset | undefined {
  return assets.find((a) => a.name === name);
}
