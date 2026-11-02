/**
 * Public, build-time configuration. EXPO_PUBLIC_* values are embedded in the
 * app bundle — they must never contain secrets (the Supabase anon key is
 * designed to be public; RLS protects the data).
 */
export const config = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  apiUrl: (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8787').replace(/\/$/, ''),
};

export const isSupabaseConfigured = config.supabaseUrl.length > 0 && config.supabaseAnonKey.length > 0;
