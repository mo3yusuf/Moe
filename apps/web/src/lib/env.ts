export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
};
export const isConfigured = Boolean(publicEnv.supabaseUrl && publicEnv.supabaseAnonKey);
const rawApi = (process.env.CRAVE_API_URL ?? '').replace(/\/$/, '');
export const apiUrl = rawApi && !/^https?:\/\//.test(rawApi) ? `https://${rawApi}` : rawApi;
