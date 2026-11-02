import { describe, expect, it } from 'vitest';
import { EventBuffer, type BufferedEvent } from '../src/event-buffer';

let n = 0;
const newId = () => `id-${++n}`;

describe('EventBuffer', () => {
  it('batches and sends events with client ids', async () => {
    const sent: BufferedEvent<string>[][] = [];
    const b = new EventBuffer<string>({ newId, maxBatch: 2, send: async (batch) => { sent.push(batch); } });
    b.push('a'); b.push('b'); b.push('c');
    await b.flush();
    expect(sent.map((x) => x.map((e) => e.payload))).toEqual([['a', 'b'], ['c']]);
    expect(new Set(sent.flat().map((e) => e.clientEventId)).size).toBe(3);
    expect(b.size).toBe(0);
  });

  it('keeps events after a failed send and retries on next flush', async () => {
    let fail = true;
    const sent: string[] = [];
    const b = new EventBuffer<string>({ newId, send: async (batch) => { if (fail) throw new Error('offline'); sent.push(...batch.map((e) => e.payload)); } });
    b.push('a');
    await b.flush();
    expect(b.size).toBe(1);
    fail = false;
    await b.flush();
    expect(sent).toEqual(['a']);
  });

  it('drops a batch after max attempts and caps memory', async () => {
    const b = new EventBuffer<number>({ newId, maxAttempts: 2, maxQueued: 3, send: async () => { throw new Error('down'); } });
    for (let i = 0; i < 5; i++) b.push(i);
    expect(b.size).toBe(3);
    expect(b.dropped).toBe(2);
    await b.flush(); await b.flush();
    expect(b.size).toBe(0);
    expect(b.dropped).toBe(5);
  });
});
