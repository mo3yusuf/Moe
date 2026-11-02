export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
};
export const isConfigured = Boolean(publicEnv.supabaseUrl && publicEnv.supabaseAnonKey);
export const apiUrl = (process.env.CRAVE_API_URL ?? '').replace(/\/$/, '');
