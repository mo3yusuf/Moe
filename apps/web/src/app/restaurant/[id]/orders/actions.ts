'use server';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';

type MerchantStatus = 'accepted' | 'rejected' | 'preparing' | 'ready' | 'completed' | 'cancelled';
type Result = { error?: string };

/** Merchant status change via the database RPC (enforces membership + state machine; notifies the customer). */
export async function setOrderStatus(restaurantId: string, orderId: string, status: MerchantStatus, reason?: string): Promise<Result> {
  const note = reason?.trim().slice(0, 200) || null;
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc('restaurant_update_order_status', { p_order_id: orderId, p_status: status, p_note: note });
  revalidatePath(`/restaurant/${restaurantId}/orders`);
  return error ? { error: error.message } : {};
}

/** Accept a new order and promise it ready in `prepMinutes`. */
export async function acceptOrder(restaurantId: string, orderId: string, prepMinutes: number): Promise<Result> {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc('restaurant_accept_order', { p_order_id: orderId, p_prep_minutes: Math.round(prepMinutes) });
  revalidatePath(`/restaurant/${restaurantId}/orders`);
  return error ? { error: error.message } : {};
}

/** Pause / resume new orders for a location (e.g. when the kitchen is slammed). */
export async function setAcceptingOrders(restaurantId: string, locationId: string, accepting: boolean): Promise<Result> {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc('set_location_accepting_orders', { p_location_id: locationId, p_accepting: accepting });
  revalidatePath(`/restaurant/${restaurantId}/orders`);
  revalidatePath(`/restaurant/${restaurantId}/hours`);
  return error ? { error: error.message } : {};
}
