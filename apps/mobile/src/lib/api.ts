import { config } from './config';
import { supabase } from './supabase';

export class ApiRequestError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

/** Calls the CRAVE API with the current user's access token. */
export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  if (!supabase) throw new ApiRequestError(0, 'demo_mode', 'Not connected to a CRAVE backend (demo mode).');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`${config.apiUrl}${path}`, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: init.signal,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiRequestError(res.status, json?.error?.code ?? 'error', json?.error?.message ?? `Request failed (${res.status})`);
  }
  return json as T;
}
