export const ORDER_STATUSES = [
  'pending_payment', 'placed', 'accepted', 'preparing', 'ready', 'completed', 'rejected', 'cancelled', 'payment_failed',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Mirrors public.order_transition_allowed() in the database. Keep both in sync (tested). */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  pending_payment: ['placed', 'payment_failed', 'cancelled'],
  payment_failed: ['pending_payment'],
  placed: ['accepted', 'rejected', 'cancelled'],
  accepted: ['preparing', 'ready', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['completed', 'cancelled'],
  completed: [],
  rejected: [],
  cancelled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export const MERCHANT_SETTABLE: readonly OrderStatus[] = ['accepted', 'rejected', 'preparing', 'ready', 'completed', 'cancelled'];

export function isTerminal(status: OrderStatus): boolean {
  return ORDER_TRANSITIONS[status].length === 0;
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: 'Awaiting payment',
  payment_failed: 'Payment failed',
  placed: 'Sent to restaurant',
  accepted: 'Accepted',
  preparing: 'Being prepared',
  ready: 'Ready for pickup',
  completed: 'Collected',
  rejected: 'Declined by restaurant',
  cancelled: 'Cancelled',
};
