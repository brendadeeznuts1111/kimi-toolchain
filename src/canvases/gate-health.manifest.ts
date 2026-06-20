/**
 * gate-health canvas manifest — highlights gate-status cards on deep links.
 * Companion IDE surface: docs/canvases/gate-health.canvas.tsx
 */

export const GATE_HEALTH_MANIFEST_ID = "gate-health";

/** Cards highlighted when ?canvas=gate-health. */
export const GATE_HEALTH_CARD_IDS = ["card-gates", "card-kimi-doctor"] as const;

export type GateHealthCardId = (typeof GATE_HEALTH_CARD_IDS)[number];

/** URLPattern for gate-health deep links (search params). */
export const GATE_HEALTH_URL_PATTERN = new URLPattern({
  search: "canvas=gate-health",
});

export const gateHealthManifest = {
  id: GATE_HEALTH_MANIFEST_ID,
  canvasId: GATE_HEALTH_MANIFEST_ID,
  cardIds: GATE_HEALTH_CARD_IDS,
  urlPattern: GATE_HEALTH_URL_PATTERN,
} as const;
