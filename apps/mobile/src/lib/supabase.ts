import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';
import { config } from './config';
import { secureStorage } from './secure-storage';

/** Null in demo mode (no backend configured). */
export const supabase: SupabaseClient | null = config.demoMode
  ? null
  : createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        storage: Platform.OS === 'web' ? undefined : secureStorage,
        autoRefreshToken: true,
        persistSession: true,
        // On web, email confirmation / password reset links land back on the site with the session in the URL.
        detectSessionInUrl: Platform.OS === 'web',
      },
    });

// Only refresh tokens while the app is in the foreground.
if (supabase && Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
