import type { SupabaseClient } from '@supabase/supabase-js';

export interface AuthedUser {
  id: string;
  email?: string;
}

export interface AuthVerifier {
  /** Returns the user for a valid, unexpired access token, otherwise null. */
  verify(accessToken: string): Promise<AuthedUser | null>;
}

/** Verifies Supabase access tokens against the Auth server (also catches revoked sessions). */
export function supabaseAuthVerifier(admin: SupabaseClient): AuthVerifier {
  return {
    async verify(token) {
      const { data, error } = await admin.auth.getUser(token);
      if (error || !data.user) return null;
      return { id: data.user.id, email: data.user.email ?? undefined };
    },
  };
}
