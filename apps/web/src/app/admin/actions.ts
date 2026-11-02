'use server';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';

/** All admin mutations go through SECURITY DEFINER functions that re-check is_admin() and write the audit log. */
async function rpc(fn: string, args: Record<string, unknown>, path: string) {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  revalidatePath(path);
}
const text = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

export async function runFraudRules() { await rpc('run_fraud_rules', {}, '/admin/fraud'); }
export async function resolveFlag(id: string, status: string, f: FormData) { await rpc('admin_resolve_fraud_flag', { p_flag_id: id, p_status: status, p_notes: text(f, 'notes') || null }, '/admin/fraud'); }
export async function decideRefund(id: string, approve: boolean, f: FormData) { await rpc('admin_decide_refund', { p_refund_id: id, p_approve: approve, p_notes: text(f, 'notes') || null }, '/admin/refunds'); }
export async function createRefund(orderId: string, f: FormData) {
  const dollars = Number(text(f, 'amount').replace(/[$,]/g, ''));
  if (!(dollars > 0)) throw new Error('Enter a refund amount');
  await rpc('admin_create_refund', { p_order_id: orderId, p_amount_cents: Math.round(dollars * 100), p_reason: text(f, 'reason') || 'other', p_details: text(f, 'details') || null }, '/admin/orders');
}
export async function setCommission(restaurantId: string, f: FormData) {
  const pct = Number(text(f, 'percent'));
  const reason = text(f, 'reason');
  if (!(pct >= 0 && pct <= 50) || !reason) throw new Error('Enter a percentage (0–50) and a reason');
  await rpc('admin_set_commission', { p_restaurant_id: restaurantId, p_bps: Math.round(pct * 100), p_reason: reason }, '/admin/commission');
}
export async function setDefaultCommission(f: FormData) {
  await rpc('admin_set_setting', { p_key: 'default_commission_bps', p_value: Math.round(Number(text(f, 'percent')) * 100) }, '/admin/commission');
}
export async function setServiceFee(f: FormData) {
  const c = (k: string) => Math.round(Number(text(f, k)) * 100);
  await rpc('admin_set_setting', { p_key: 'service_fee', p_value: { percent_bps: Math.round(Number(text(f, 'percent')) * 100), fixed_cents: c('fixed'), min_cents: c('min'), max_cents: c('max') } }, '/admin/commission');
}
export async function updateCreator(id: string, f: FormData) {
  const pct = text(f, 'commission');
  await rpc('admin_update_creator', { p_creator_id: id, p_verified: f.get('verified') === 'on', p_affiliate: text(f, 'affiliate'), p_commission_bps: pct ? Math.round(Number(pct) * 100) : null }, '/admin/creators');
}
export async function resolveReport(id: string, remove: boolean, f: FormData) { await rpc('admin_resolve_report', { p_report_id: id, p_remove_content: remove, p_notes: text(f, 'notes') || null }, '/admin/reports'); }
export async function decideAppeal(id: string, overturn: boolean, f: FormData) { await rpc('admin_decide_appeal', { p_appeal_id: id, p_overturn: overturn, p_notes: text(f, 'notes') || null }, '/admin/reports'); }
export async function setTicketStatus(id: string, status: string) {
  const supabase = await supabaseServer();
  const { error } = await supabase.from('support_tickets').update({ status }).eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/admin/support');
}

export async function refreshSimilarity() { await rpc('refresh_video_similarity', {}, '/admin/recommendations'); }
