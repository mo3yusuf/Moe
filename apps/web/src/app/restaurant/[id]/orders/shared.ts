/** Shared by the orders page (server) and the live board (browser). */
export interface BoardOrder {
  id: string; order_number: string; status: string; pickup_name: string; customer_note: string | null;
  scheduled_for: string | null; placed_at: string | null; estimated_ready_at: string | null;
  subtotal_cents: number; commission_cents: number; restaurant_net_cents: number; cancel_reason: string | null;
  source_video_id: string | null; fulfilment: string;
  order_items: { name: string; quantity: number; options: { name: string }[] | null; notes: string | null }[] | null;
  deliveries: { status: string; suburb: string | null; courier_name: string | null } | { status: string; suburb: string | null; courier_name: string | null }[] | null;
}
export const ORDER_COLUMNS = 'id, order_number, status, pickup_name, customer_note, scheduled_for, placed_at, estimated_ready_at, subtotal_cents, commission_cents, restaurant_net_cents, cancel_reason, source_video_id, fulfilment, order_items(name, quantity, options, notes), deliveries(status, suburb, courier_name)';
