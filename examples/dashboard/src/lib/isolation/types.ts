import type { MessagePort } from "node:worker_threads";

export type IsolationMode = "worker" | "realm" | "messageport";

export interface IsolationChannel {
  hostPort: MessagePort;
  dispose(): void;
  [Symbol.dispose]?(): void;
}

export interface IsolationEffect {
  readonly mode: IsolationMode;
  readonly available: boolean;
  run<T>(fn: () => T | Promise<T>): Promise<T>;
  evaluateScript(code: string, globals?: Record<string, unknown>): Promise<unknown>;
  createChannel(): IsolationChannel;
}

export interface IsolationCapabilities {
  shadowRealm: boolean;
  worker: boolean;
  messagePort: boolean;
  resolvedEnv: string;
}
