'use server';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';

/** Creates (or reopens) CRAVE Demo Kitchen, owned by this admin, then opens its dashboard. */
export async function createSampleRestaurant(): Promise<void> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc('admin_create_demo_restaurant');
  if (error || !data) throw new Error(error?.message ?? 'Could not create the sample restaurant');
  redirect(`/restaurant/${data as string}`);
}
