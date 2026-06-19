import { join } from "path";
import { fetchDashboardCanvases } from "../../../../src/lib/herdr-dashboard-data.ts";
import { fetchDashboardCardsPayload } from "../../../../src/lib/dashboard-card-registry.ts";
import { apiGates, jsonResponse } from "./api-handlers.ts";

const REPO_ROOT = join(import.meta.dir, "../../../..");

export function apiCanvases(): Response {
  return jsonResponse(fetchDashboardCanvases());
}

export async function apiCards(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const canvas = url.searchParams.get("canvas");

  let gateJson: unknown;
  try {
    const gateRes = await apiGates();
    if (gateRes.ok) gateJson = await gateRes.json();
  } catch {
    gateJson = undefined;
  }

  const payload = await fetchDashboardCardsPayload(REPO_ROOT, { canvas, gateJson });
  return jsonResponse(payload);
}