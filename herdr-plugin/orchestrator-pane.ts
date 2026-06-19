#!/usr/bin/env bun
// Plugin pane: minimal event stream monitor.
// Opens as an overlay pane; prints workspace/pane/agent events.

import { herdrSocketSubscribe } from "../src/lib/herdr-socket-client.ts";

herdrSocketSubscribe({
  subscriptions: [
    { type: "workspace.created" },
    { type: "workspace.focused" },
    { type: "workspace.closed" },
  ],
  onEvent: (envelope) => {
    const { event, data } = envelope;
    const workspace = (data?.workspace ?? {}) as Record<string, unknown>;

    const line = [new Date().toISOString(), event, workspace.workspace_id || "-"]
      .filter(Boolean)
      .join(" ");
    console.log(line);
  },
  onError: (error) => {
    console.error("event stream error:", error);
  },
});

// Keep the pane open until it is closed by the user.
setInterval(() => {}, 1 << 30);
