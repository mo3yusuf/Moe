/**
 * Public runtime configuration. EXPO_PUBLIC_* values are compiled into the app bundle and are
 * visible to anyone — only the Supabase anon key (protected by RLS) belongs here.
 */
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const stripePublishableKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';
const apiUrl = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/$/, '');

export const config = {
  supabaseUrl,
  supabaseAnonKey,
  apiUrl,
  /** Publishable key only (pk_...). Card payments are disabled when absent. */
  stripePublishableKey,
  /**
   * Demo mode: no backend configured. The app runs on bundled demonstration data, sign-in is
   * skipped and ordering/payments are disabled. Always shown to the user with a visible banner.
   */
  demoMode: !supabaseUrl || !supabaseAnonKey || !apiUrl,
} as const;
