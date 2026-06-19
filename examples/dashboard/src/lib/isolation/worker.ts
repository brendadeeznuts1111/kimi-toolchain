import type { IsolationChannel, IsolationEffect } from "./types.ts";

function spawnWorkerScript(script: string): { worker: Worker; url: string } {
  const url = URL.createObjectURL(new Blob([script], { type: "application/javascript" }));
  return { worker: new Worker(url), url };
}

function disposeWorker(worker: Worker, url: string): void {
  worker.terminate();
  URL.revokeObjectURL(url);
}

export function createWorkerIsolation(): IsolationEffect {
  return {
    mode: "worker",
    available: true,

    run<T>(fn: () => T | Promise<T>): Promise<T> {
      const { worker, url } = spawnWorkerScript(`self.postMessage((${fn.toString()})());`);
      return new Promise((resolve, reject) => {
        worker.onmessage = (e) => {
          disposeWorker(worker, url);
          resolve(e.data as T);
        };
        worker.onerror = (e) => {
          disposeWorker(worker, url);
          reject(e.error ?? new Error("worker run failed"));
        };
      });
    },

    async evaluateScript(code: string, _globals?: Record<string, unknown>): Promise<unknown> {
      const { worker, url } = spawnWorkerScript(
        `self.onmessage = () => self.postMessage(eval(${JSON.stringify(code)}));`
      );
      return new Promise((resolve, reject) => {
        worker.onmessage = (e) => {
          disposeWorker(worker, url);
          resolve(e.data);
        };
        worker.onerror = (e) => {
          disposeWorker(worker, url);
          reject(e.error ?? new Error("worker eval failed"));
        };
        worker.postMessage(null);
      });
    },

    createChannel(): IsolationChannel {
      throw new Error("Worker Channel pair not directly exposed; use the worker itself");
    },
  };
}

/** Ping/pong roundtrip via Web Worker — used by isolation benchmarks. */
export async function benchmarkWorkerRoundtrip(): Promise<number> {
  const { worker, url } = spawnWorkerScript(`
    self.onmessage = (event) => {
      if (event.data === "ping") self.postMessage("pong");
    };
  `);
  const start = performance.now();
  try {
    await new Promise<void>((resolve, reject) => {
      worker.onmessage = (event) => {
        if (event.data === "pong") resolve();
        else reject(new Error("unexpected worker roundtrip reply"));
      };
      worker.onerror = (event) => reject(event.error ?? new Error("worker roundtrip failed"));
      worker.postMessage("ping");
    });
    return performance.now() - start;
  } finally {
    disposeWorker(worker, url);
  }
}

/** Worker spawn + teardown cost (ms). */
export function benchmarkWorkerCreateChannel(): number {
  const start = performance.now();
  const { worker, url } = spawnWorkerScript(`self.close();`);
  disposeWorker(worker, url);
  return performance.now() - start;
}
