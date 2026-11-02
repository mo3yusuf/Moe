'use server';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';

type MerchantStatus = 'accepted' | 'rejected' | 'preparing' | 'ready' | 'completed' | 'cancelled';

/** Merchant status change via the database RPC (enforces membership + state machine; notifies the customer). */
export async function updateStatus(restaurantId: string, orderId: string, status: MerchantStatus, form?: FormData) {
  const note = form ? String(form.get('reason') ?? '').trim().slice(0, 200) || null : null;
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc('restaurant_update_order_status', { p_order_id: orderId, p_status: status, p_note: note });
  if (error) throw new Error(error.message);
  revalidatePath(`/restaurant/${restaurantId}/orders`);
}
