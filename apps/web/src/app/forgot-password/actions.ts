'use server';
import { headers } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';

/** Emails a password-reset link. Always answers the same way, so it can't reveal who has an account. */
export async function requestReset(_prev: { done?: boolean; error?: string } | undefined, form: FormData) {
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Enter a valid email address' };
  const h = await headers();
  const origin = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('x-forwarded-host') ?? h.get('host')}`;
  const supabase = await supabaseServer();
  await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/confirm?next=/reset-password` });
  return { done: true };
}
