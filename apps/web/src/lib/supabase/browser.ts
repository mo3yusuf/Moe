'use client';
import { createBrowserClient } from '@supabase/ssr';

/** Browser client bound to the signed-in user's cookie session (anon key; RLS applies). */
export function supabaseBrowser() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
