'use server';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';

export async function setNewPassword(_prev: { error?: string } | undefined, form: FormData) {
  const password = String(form.get('password') ?? '');
  const confirm = String(form.get('confirm') ?? '');
  if (password.length < 10) return { error: 'Use at least 10 characters' };
  if (password !== confirm) return { error: 'The two passwords don’t match' };
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'This reset link has expired. Request a new one.' };
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };
  redirect('/?password=updated');
}
