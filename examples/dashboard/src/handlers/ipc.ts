// ── IPC ────────────────────────────────────────────────────────────

export async function apiIpc(): Promise<Response> {
  const childCode = `
process.on("message", (msg) => {
  process.send({ echo: msg, from: "child", pid: process.pid });
});
process.send({ ready: true, pid: process.pid });
`;
  await Bun.write("/tmp/_ipc_child.ts", childCode);

  const messages: { direction: string; data: unknown }[] = [];

  return new Promise((resolve) => {
    const child = Bun.spawn(["bun", "run", "/tmp/_ipc_child.ts"], {
      ipc(msg) {
        messages.push({ direction: "child→parent", data: msg });
        // Got echo back — done
        if ((msg as any).echo) {
          child.kill();
        }
      },
      serialization: "json",
    });

    child.send({ hello: "from parent" });

    // Safety timeout
    setTimeout(async () => {
      try { child.kill(); } catch {}
      await child.exited.catch(() => {});
      resolve(jsonResponse({
        childPid: child.pid,
        messages,
        parentApi: "child.send(msg) + ipc(handler)",
        childApi: "process.send(msg) + process.on('message', handler)",
        serialization: "json (cross-engine compat)",
        note: "Bun.spawn IPC: native message passing. serialization: 'advanced' (default, JSC) or 'json' (Node.js compat). Bun↔Node IPC works with 'json'.",
      }));
    }, 3000);
  });
}

