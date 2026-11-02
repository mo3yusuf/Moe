import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { config } from '@/lib/config';
import { supabase } from '@/lib/supabase';

export const PRIVACY_POLICY_VERSION = '2026-11-draft';

export interface SignUpInput {
  email: string;
  password: string;
  displayName: string;
  personalisationConsent: boolean;
  marketingEmailConsent: boolean;
}

interface AuthState {
  session: Session | null;
  isLoading: boolean;
  demoMode: boolean;
  signIn(email: string, password: string): Promise<void>;
  signUp(input: SignUpInput): Promise<{ needsEmailConfirmation: boolean }>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(!config.demoMode);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setIsLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthState>(() => ({
    session,
    isLoading,
    demoMode: config.demoMode,
    async signIn(email, password) {
      if (!supabase) throw new Error('Demo mode: no backend configured');
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw new Error(error.message);
    },
    async signUp(input) {
      if (!supabase) throw new Error('Demo mode: no backend configured');
      // Consents travel in user metadata and are recorded server-side by the handle_new_user trigger,
      // so they are captured even when email confirmation delays the first session.
      const { data, error } = await supabase.auth.signUp({
        email: input.email.trim(),
        password: input.password,
        options: {
          data: {
            display_name: input.displayName.trim(),
            policy_version: PRIVACY_POLICY_VERSION,
            consents: {
              personalisation: input.personalisationConsent,
              marketing_email: input.marketingEmailConsent,
            },
          },
        },
      });
      if (error) throw new Error(error.message);
      return { needsEmailConfirmation: !data.session };
    },
    async signOut() {
      await supabase?.auth.signOut();
    },
  }), [session, isLoading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
