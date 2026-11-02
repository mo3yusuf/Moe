'use server';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';

export async function decide(verificationId: string, approve: boolean, form: FormData) {
  const notes = String(form.get('notes') ?? '').trim().slice(0, 500);
  if (!approve && !notes) throw new Error('A reason is required to reject');
  const supabase = await supabaseServer();
  // admin_decide_verification checks is_admin() in the database and writes the audit log.
  const { error } = await supabase.rpc('admin_decide_verification', { p_verification_id: verificationId, p_approve: approve, p_notes: notes || null });
  if (error) throw new Error(error.message);
  revalidatePath('/admin/verifications');
}
