/**
 * Shared Herdr socket message parsing — JSONL lines and WebSocket frames.
 */

export interface HerdrStreamEnvelope {
  event?: string;
  data?: Record<string, unknown>;
}

export interface HerdrEventSubscription {
  type: string;
  pane_id?: string;
  agent_status?: string;
}

export function parseHerdrSocketJsonLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function createJsonlLineBuffer(onLine: (line: string) => void): (chunk: string) => void {
  let buffer = "";
  return (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      onLine(line);
      newline = buffer.indexOf("\n");
    }
  };
}

export function herdrStreamEnvelopeFromJson(
  json: Record<string, unknown>
): HerdrStreamEnvelope | null {
  if (json.event && typeof json.event === "string") {
    return {
      event: json.event,
      data: (json.data as Record<string, unknown> | undefined) ?? undefined,
    };
  }

  if (typeof json.event === "string" || typeof json.data === "object") {
    const data = json.data as Record<string, unknown> | undefined;
    const event =
      typeof json.event === "string"
        ? json.event
        : typeof data?.type === "string"
          ? String(data.type)
          : undefined;
    if (event) return { event, data };
  }

  return null;
}

export function handleHerdrSubscribeFrame(
  json: Record<string, unknown>,
  state: { acked: boolean },
  onEvent: (envelope: HerdrStreamEnvelope) => void,
  onError?: (error: string) => void
): "subscription_failed" | "subscription_ok" | "event" | "ignore" {
  if (!state.acked) {
    state.acked = true;
    const result = json.result as { type?: string } | undefined;
    if (json.error || result?.type !== "subscription_started") {
      onError?.((json.error as { message?: string } | undefined)?.message || "subscription failed");
      return "subscription_failed";
    }
    return "subscription_ok";
  }

  const envelope = herdrStreamEnvelopeFromJson(json);
  if (envelope) {
    onEvent(envelope);
    return "event";
  }
  return "ignore";
}
