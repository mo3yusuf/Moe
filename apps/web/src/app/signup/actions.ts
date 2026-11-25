'use server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';

export interface SignUpState { error?: string; checkEmail?: string; fields?: { name: string; email: string } }

/**
 * Business account sign-up (restaurant owners). Same CRAVE account system as the app; business
 * accounts opt out of personalisation and marketing by default. Then straight into store setup.
 */
export async function signUpBusiness(_prev: SignUpState | undefined, form: FormData): Promise<SignUpState> {
  const name = String(form.get('name') ?? '').trim().slice(0, 60);
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const password = String(form.get('password') ?? '');
  const fields = { name, email };
  if (name.length < 2) return { error: 'Enter your name.', fields };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Enter a valid email address.', fields };
  if (password.length < 10) return { error: 'Use a password of at least 10 characters.', fields };
  if (form.get('authorised') !== 'on') return { error: 'Please confirm you’re authorised to list this business.', fields };

  const h = await headers();
  const origin = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('x-forwarded-host') ?? h.get('host')}`;
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: {
      emailRedirectTo: `${origin}/auth/confirm?next=/restaurant/onboarding`,
      data: { display_name: name, policy_version: '2026-11-draft', account_type: 'business', consents: { personalisation: false, marketing_email: false } },
    },
  });
  if (error) return { error: error.message, fields };
  if (data.session) redirect('/restaurant/onboarding');
  return { checkEmail: email };
}
