/**
 * tls-compliance.ts — Security gate that verifies the TLS minimum-version policy.
 *
 * Ensures the HTTP client rejects handshakes below the configured floor. The
 * default production floor is TLS 1.2.
 */

import { makeHttpClient, type TLSVersion } from "../lib/http-client.ts";

export interface TLSComplianceResult {
  status: "pass" | "fail";
  reason?: string;
}

const DEFAULT_TEST_ENDPOINTS = {
  tls11: Bun.env.KIMI_TLS_TEST_TLS11_URL ?? "https://tls-v1-1.badssl.com:1011/",
  tls10: Bun.env.KIMI_TLS_TEST_TLS10_URL ?? "https://tls-v1-0.badssl.com:1010/",
};

async function fetchOutcome(
  client: ReturnType<typeof makeHttpClient>,
  url: string
): Promise<"ACCEPTED" | "REJECTED"> {
  try {
    await client.fetch(url);
    return "ACCEPTED";
  } catch {
    return "REJECTED";
  }
}

/** Run the TLS minimum-version compliance gate. */
export async function tlsComplianceGate(options?: {
  floor?: TLSVersion;
  endpoints?: { tls11?: string; tls10?: string };
}): Promise<TLSComplianceResult> {
  const floor = options?.floor ?? "TLSv1.2";
  const endpoints = {
    tls11: options?.endpoints?.tls11 ?? DEFAULT_TEST_ENDPOINTS.tls11,
    tls10: options?.endpoints?.tls10 ?? DEFAULT_TEST_ENDPOINTS.tls10,
  };

  const client = makeHttpClient({ minTLS: floor });

  const tls11Result = await fetchOutcome(client, endpoints.tls11);
  if (tls11Result === "ACCEPTED") {
    return { status: "fail", reason: "TLS 1.1 accepted below policy floor" };
  }

  const tls10Result = await fetchOutcome(client, endpoints.tls10);
  if (tls10Result === "ACCEPTED") {
    return { status: "fail", reason: "TLS 1.0 accepted below policy floor" };
  }

  return { status: "pass" };
}
