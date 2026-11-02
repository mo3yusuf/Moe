'use server';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';

function safeNext(next: FormDataEntryValue | null): string {
  const value = typeof next === 'string' ? next : '';
  // Only allow same-site relative paths (prevents open redirects).
  return value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

export async function signIn(_prev: { error?: string } | undefined, formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) return { error: 'Email and password are required' };
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  redirect(safeNext(formData.get('next')));
}

export async function signOut() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect('/login');
}
