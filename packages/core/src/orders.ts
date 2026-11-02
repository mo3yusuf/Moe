/**
 * Order lifecycle. The database enforces the same transitions in a trigger
 * (see supabase/migrations), this module is the single source of truth for the
 * application layer and the UI.
 */

export const ORDER_STATUSES = [
  'pending_payment', // created, awaiting Stripe confirmation via webhook
  'placed', // payment authorised/succeeded, waiting for restaurant
  'accepted',
  'preparing',
  'ready_for_pickup',
  'completed',
  'rejected', // restaurant declined → refund
  'cancelled', // customer/admin cancelled → refund if paid
  'payment_failed',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type OrderActor = 'customer' | 'restaurant' | 'admin' | 'system';

const TRANSITIONS: Record<OrderStatus, Partial<Record<OrderStatus, readonly OrderActor[]>>> = {
  pending_payment: {
    placed: ['system'],
    payment_failed: ['system'],
    cancelled: ['customer', 'system', 'admin'],
  },
  placed: {
    accepted: ['restaurant', 'admin'],
    rejected: ['restaurant', 'admin'],
    cancelled: ['customer', 'admin', 'system'],
  },
  accepted: {
    preparing: ['restaurant', 'admin'],
    ready_for_pickup: ['restaurant', 'admin'],
    cancelled: ['restaurant', 'admin'],
  },
  preparing: {
    ready_for_pickup: ['restaurant', 'admin'],
    cancelled: ['restaurant', 'admin'],
  },
  ready_for_pickup: {
    completed: ['restaurant', 'admin', 'system'],
  },
  completed: {},
  rejected: {},
  cancelled: {},
  payment_failed: {},
};

export function canTransition(from: OrderStatus, to: OrderStatus, actor: OrderActor): boolean {
  return TRANSITIONS[from][to]?.includes(actor) ?? false;
}

export function allowedNextStatuses(from: OrderStatus, actor: OrderActor): OrderStatus[] {
  return (Object.entries(TRANSITIONS[from]) as [OrderStatus, readonly OrderActor[]][])
    .filter(([, actors]) => actors.includes(actor))
    .map(([status]) => status);
}

export function isTerminal(status: OrderStatus): boolean {
  return Object.keys(TRANSITIONS[status]).length === 0;
}

/** Statuses after which a refund must be issued if money was captured. */
export function requiresRefundOnEntry(to: OrderStatus): boolean {
  return to === 'rejected' || to === 'cancelled';
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: 'Awaiting payment',
  placed: 'Sent to restaurant',
  accepted: 'Accepted',
  preparing: 'Being prepared',
  ready_for_pickup: 'Ready for pickup',
  completed: 'Picked up',
  rejected: 'Declined by restaurant',
  cancelled: 'Cancelled',
  payment_failed: 'Payment failed',
};
