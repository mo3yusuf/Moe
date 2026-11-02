import 'server-only';
import { apiUrl } from './env';
import { supabaseServer } from './supabase/server';

/** Server-side call to the CRAVE API as the signed-in user (for privileged operations). */
export async function apiFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  if (!apiUrl) throw new Error('CRAVE_API_URL is not configured');
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in');
  const res = await fetch(`${apiUrl}${path}`, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error?.message ?? `API error ${res.status}`);
  return json as T;
}
