'use server';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';

export async function openTicket(restaurantId: string, _p: { error?: string; ok?: string } | undefined, form: FormData) {
  const subject = String(form.get('subject') ?? '').trim();
  const body = String(form.get('body') ?? '').trim();
  const orderNumber = String(form.get('order') ?? '').trim();
  if (!subject || !body) return { error: 'Add a subject and a description.' };
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Please sign in again.' };
  let orderId: string | null = null;
  if (orderNumber) {
    const { data } = await supabase.from('orders').select('id').eq('order_number', orderNumber).eq('restaurant_id', restaurantId).maybeSingle();
    if (!data) return { error: `Order ${orderNumber} not found for this restaurant.` };
    orderId = data.id;
  }
  const { error } = await supabase.from('support_tickets').insert({ opened_by: user.id, restaurant_id: restaurantId, order_id: orderId, subject: subject.slice(0, 140), body: body.slice(0, 4000) });
  if (error) return { error: error.message };
  revalidatePath(`/restaurant/${restaurantId}/support`);
  return { ok: 'Request sent. The CRAVE team will reply by email.' };
}
