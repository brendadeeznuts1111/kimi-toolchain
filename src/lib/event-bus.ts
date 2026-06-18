/**
 * event-bus.ts — Lightweight typed in-process event bus (Bun-native, no Node EventEmitter).
 */

export type EventHandler<T> = (payload: T) => void;

export interface EventBusOptions {
  /** Per-event listener cap; excess registrations throw. */
  maxListeners?: number;
}

const DEFAULT_MAX_LISTENERS = 32;

/** Typed publish/subscribe bus with unsubscribe handles and listener guards. */
export class EventBus<TEvents extends Record<string, unknown>> {
  private readonly listeners = new Map<keyof TEvents, Set<EventHandler<unknown>>>();
  private readonly maxListeners: number;

  constructor(options: EventBusOptions = {}) {
    this.maxListeners = options.maxListeners ?? DEFAULT_MAX_LISTENERS;
  }

  on<K extends keyof TEvents>(event: K, handler: EventHandler<TEvents[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    if (set.size >= this.maxListeners) {
      throw new Error(
        `event-bus: max listeners (${this.maxListeners}) exceeded for ${String(event)}`
      );
    }
    const wrapped = handler as EventHandler<unknown>;
    set.add(wrapped);
    return () => {
      set?.delete(wrapped);
    };
  }

  off<K extends keyof TEvents>(event: K, handler: EventHandler<TEvents[K]>): void {
    this.listeners.get(event)?.delete(handler as EventHandler<unknown>);
  }

  emit<K extends keyof TEvents>(event: K, payload: TEvents[K]): void {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return;
    for (const handler of [...set]) {
      try {
        handler(payload);
      } catch {
        /* subscriber errors must not break publishers */
      }
    }
  }

  listenerCount<K extends keyof TEvents>(event: K): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  clear(): void {
    this.listeners.clear();
  }
}
