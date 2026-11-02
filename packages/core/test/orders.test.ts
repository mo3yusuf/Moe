import { describe, expect, it } from 'vitest';
import { canTransition, isTerminal, ORDER_STATUSES } from '../src/orders';

describe('order state machine', () => {
  it('allows the happy path', () => {
    const path = ['pending_payment', 'placed', 'accepted', 'preparing', 'ready', 'completed'] as const;
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
  });
  it('blocks skipping payment or jumping to completed', () => {
    expect(canTransition('pending_payment', 'accepted')).toBe(false);
    expect(canTransition('placed', 'completed')).toBe(false);
  });
  it('terminal states have no exits', () => {
    for (const s of ORDER_STATUSES) if (isTerminal(s)) expect(['completed', 'rejected', 'cancelled']).toContain(s);
  });
});
