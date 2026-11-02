import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from './supabase';

export const POLICY_VERSION = '2026-11-draft';

export interface Profile {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  visibility: 'public' | 'private';
  personalisation_enabled: boolean;
  follower_count: number;
  following_count: number;
}

interface AuthState {
  ready: boolean;
  session: Session | null;
  profile: Profile | null;
  roles: string[];
  refreshProfile: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: { email: string; password: string; displayName: string; personalisation: boolean; age16Plus: boolean }) => Promise<{ needsConfirmation: boolean }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!supabase);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<string[]>([]);

  async function loadProfile(userId: string | undefined) {
    if (!supabase || !userId) {
      setProfile(null);
      setRoles([]);
      return;
    }
    const [{ data: p }, { data: r }] = await Promise.all([
      supabase.from('profiles').select('id, username, display_name, avatar_url, bio, visibility, personalisation_enabled, follower_count, following_count').eq('id', userId).maybeSingle(),
      supabase.from('user_roles').select('role').eq('user_id', userId),
    ]);
    setProfile((p as Profile | null) ?? null);
    setRoles((r ?? []).map((x: { role: string }) => x.role));
  }

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await loadProfile(data.session?.user.id);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      void loadProfile(s?.user.id);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      ready,
      session,
      profile,
      roles,
      refreshProfile: () => loadProfile(session?.user.id),
      async signIn(email, password) {
        if (!supabase) throw new Error('Sign-in is unavailable: Supabase is not configured.');
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Email or password is incorrect.' : error.message);
      },
      async signUp({ email, password, displayName, personalisation, age16Plus }) {
        if (!supabase) throw new Error('Sign-up is unavailable: Supabase is not configured.');
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              display_name: displayName.trim(),
              policy_version: POLICY_VERSION,
              accepted_terms: true,
              personalisation_opt_in: personalisation,
              age_16_plus: age16Plus,
            },
          },
        });
        if (error) throw new Error(error.message);
        return { needsConfirmation: !data.session };
      },
      async signOut() {
        await supabase?.auth.signOut();
      },
    }),
    [ready, session, profile, roles],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
