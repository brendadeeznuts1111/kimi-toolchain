// ── IPC Matrix ─────────────────────────────────────────────────────

export async function apiIpcMatrix(): Promise<Response> {
  const messagePort = isMessagePortIsolationAvailable();
  return jsonResponse({
    mechanisms: [
      { mechanism: "MessagePort (same thread)", isolation: "vm.Context", thread: "Same", useCase: "Sandboxed plugins", status: "vm.runInContext ✅" },
      {
        mechanism: "moveMessagePortToContext",
        isolation: "vm.Context",
        thread: "Same",
        useCase: "Bridge vm ↔ main",
        status: messagePort ? "✅" : "not yet implemented",
      },
      { mechanism: "Worker + postMessage", isolation: "Full process", thread: "Separate", useCase: "CPU-intensive tasks", status: "✅" },
      { mechanism: "ShadowRealm + wrapped fn", isolation: "Distinct globals", thread: "Same", useCase: "Pure computation", status: "✅ evaluate() + importValue()" },
      { mechanism: "Bun.spawn + IPC (ipc handler)", isolation: "Full process", thread: "Separate", useCase: "Untrusted code", status: "✅" },
    ],
    shadowRealmNote: "ShadowRealm does NOT support MessagePort transfer — only wrapped functions from importValue(). Use vm.createContext() + moveMessagePortToContext for port-based sandbox comms.",
    isolationFactory: getIsolationCapabilities(),
    note: "IPC isolation spectrum: same-thread (ShadowRealm, vm.Context) → separate thread (Worker) → separate process (Bun.spawn IPC). Choose by risk profile. Toggle via KIMI_ISOLATION=worker|realm|messageport.",
  });
}

