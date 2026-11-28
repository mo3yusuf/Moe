'use server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { apiUrl } from '@/lib/env';
import { supabaseServer } from '@/lib/supabase/server';

/** Creates (or reopens) CRAVE Demo Kitchen only, then opens its dashboard. */
export async function createSampleRestaurant(): Promise<void> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc('admin_create_demo_restaurant');
  if (error || !data) throw new Error(error?.message ?? 'Could not create the sample restaurant');
  redirect(`/restaurant/${data as string}`);
}

/**
 * Creates the five sample restaurants with menus and a sample video each. The sample videos ship with
 * both the customer app (fast, never sleeps — preferred) and this dashboard (fallback); the app's
 * address comes from the API, and is only used if a sample file really loads from it.
 */
export async function createSampleRestaurants(): Promise<void> {
  const h = await headers();
  const dashboard = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('x-forwarded-host') ?? h.get('host')}`;
  let mediaBase = dashboard;
  try {
    if (apiUrl) {
      const cfg = (await (await fetch(`${apiUrl}/app-config`, { signal: AbortSignal.timeout(60_000) })).json()) as { appUrl?: string | null };
      if (cfg.appUrl && /^https:\/\/[^/\s]+$/.test(cfg.appUrl)) {
        const probe = await fetch(`${cfg.appUrl}/samples/burger.jpg`, { method: 'HEAD', signal: AbortSignal.timeout(15_000) });
        if (probe.ok && (probe.headers.get('content-type') ?? '').startsWith('image/')) mediaBase = cfg.appUrl;
      }
    }
  } catch { /* use the dashboard */ }
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc('admin_create_sample_restaurants', { p_media_base: mediaBase });
  if (error) throw new Error(error.message);
  redirect('/restaurant');
}
