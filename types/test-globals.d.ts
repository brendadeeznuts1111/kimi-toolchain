/** Shim types for test environments without DOM lib or undici-types in tsconfig.
 * Bun's runtime provides Web API globals (Response, Headers, Request, fetch, etc.)
 * but @types/bun@1.3.14 does not always declare them globally when tsconfig `lib`
 * lacks "DOM". Remove these stubs when @types/bun catches up to Bun 1.4.0.
 */
declare global {
  interface Response {
    readonly ok: boolean;
    readonly status: number;
    readonly statusText: string;
    readonly body: ReadableStream<Uint8Array> | null;
    arrayBuffer(): Promise<ArrayBuffer>;
    blob(): Promise<Blob>;
    json(): Promise<any>;
    text(): Promise<string>;
    readonly headers: Headers;
  }

  interface Headers {
    get(name: string): string | null;
    set(name: string, value: string): void;
    has(name: string): boolean;
    getSetCookie(): string[];
    entries(): IterableIterator<[string, string]>;
  }

  interface Request {
    readonly url: string;
    readonly method: string;
    text(): Promise<string>;
  }
}

declare module "bun" {
  namespace __internal {
    interface BunHeadersOverride {
      get(name: string): string | null;
      set(name: string, value: string): void;
      has(name: string): boolean;
      getSetCookie(): string[];
      entries(): IterableIterator<[string, string]>;
    }
  }
}

export {};
