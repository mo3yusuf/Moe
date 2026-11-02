/**
 * Client-side batching for recommendation events: fewer requests, battery friendly, resilient to
 * flaky mobile networks. Each event gets a client id so retried batches are de-duplicated server-side.
 */
export interface BufferedEvent<T> {
  clientEventId: string;
  occurredAt: string;
  payload: T;
}

export interface EventBufferOptions<T> {
  send(batch: BufferedEvent<T>[]): Promise<void>;
  newId(): string;
  now?: () => Date;
  maxBatch?: number;
  /** Hard cap; oldest events are dropped beyond this (we never grow memory without bound). */
  maxQueued?: number;
  maxAttempts?: number;
}

export class EventBuffer<T> {
  private queue: BufferedEvent<T>[] = [];
  private inFlight: Promise<void> | null = null;
  private failures = 0;
  dropped = 0;

  constructor(private opts: EventBufferOptions<T>) {}

  get size() { return this.queue.length; }

  push(payload: T): void {
    this.queue.push({ clientEventId: this.opts.newId(), occurredAt: (this.opts.now?.() ?? new Date()).toISOString(), payload });
    const cap = this.opts.maxQueued ?? 500;
    if (this.queue.length > cap) {
      const excess = this.queue.length - cap;
      this.queue.splice(0, excess);
      this.dropped += excess;
    }
  }

  /** Sends queued events in batches. Safe to call often; concurrent calls share one flush. */
  flush(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.drain().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async drain(): Promise<void> {
    const maxBatch = this.opts.maxBatch ?? 50;
    while (this.queue.length) {
      const batch = this.queue.slice(0, maxBatch);
      try {
        await this.opts.send(batch);
        this.queue.splice(0, batch.length);
        this.failures = 0;
      } catch {
        this.failures += 1;
        if (this.failures >= (this.opts.maxAttempts ?? 5)) {
          // Give up on this batch rather than retrying forever; signals are best-effort.
          this.queue.splice(0, batch.length);
          this.dropped += batch.length;
          this.failures = 0;
        }
        return; // retry on the next flush
      }
    }
  }
}
