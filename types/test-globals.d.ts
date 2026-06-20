/** Minimal fetch surface for tests without DOM lib or undici-types in tsconfig. */
declare global {
  interface Response {
    readonly ok: boolean;
    readonly status: number;
    readonly statusText: string;
    readonly body: ReadableStream<Uint8Array> | null;
    arrayBuffer(): Promise<ArrayBuffer>;
    json(): Promise<unknown>;
    text(): Promise<string>;
    readonly headers: Headers;
  }

  interface Headers {
    get(name: string): string | null;
  }

  interface Request {
    readonly url: string;
    readonly method: string;
  }
}

declare module "bun" {
  namespace __internal {
    interface BunHeadersOverride {
      get(name: string): string | null;
    }
  }
}

export {};
