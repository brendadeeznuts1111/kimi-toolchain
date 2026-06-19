/**
 * Parallelism Governor: semaphore-based concurrency limiter
 */

import { DEFAULTS } from "./governor-state.ts";

export class ParallelGovernor {
  private semaphore: number;
  private queue: Array<() => void> = [];

  constructor(maxConcurrent = DEFAULTS.maxParallelJobs) {
    this.semaphore = maxConcurrent;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.semaphore > 0) {
      this.semaphore--;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  private release() {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next?.();
    } else {
      this.semaphore++;
    }
  }

  get available() {
    return this.semaphore;
  }

  get queued() {
    return this.queue.length;
  }
}
