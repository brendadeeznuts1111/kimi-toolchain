import { dirname } from "path";
import { makeDir } from "../../src/lib/bun-io.ts";

export type RejectingUnixServer = {
  socketPath: string;
  startAccepting: () => void;
  stop: () => void;
};

/**
 * Test unix listener — rejects connections until startAccepting().
 * Bun >= 1.1 removes the socket file on listener.stop().
 */
export function createRejectingUnixServer(socketPath: string): RejectingUnixServer {
  makeDir(dirname(socketPath), { recursive: true });

  let accepting = false;
  const listener = Bun.listen({
    unix: socketPath,
    socket: {
      open(socket) {
        if (!accepting) {
          socket.end();
          return;
        }
        socket.write(`${JSON.stringify({ result: { type: "subscription_started" } })}\n`);
      },
      data() {},
    },
  });

  return {
    socketPath,
    startAccepting: () => {
      accepting = true;
    },
    stop: () => listener.stop(),
  };
}
