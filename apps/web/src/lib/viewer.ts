import { redirect } from 'next/navigation';
import { supabaseServer } from './supabase/server';

export interface Viewer {
  id: string;
  email: string | undefined;
  isAdmin: boolean;
  restaurants: { id: string; name: string; status: string; role: string }[];
}

/** Loads the signed-in user, their roles and restaurant memberships (RLS-scoped). */
export async function getViewer(): Promise<Viewer | null> {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const [roles, members] = await Promise.all([
    supabase.from('user_roles').select('role').eq('user_id', user.id),
    supabase.from('restaurant_members').select('role, restaurants(id, name, status)').eq('user_id', user.id),
  ]);
  return {
    id: user.id,
    email: user.email,
    isAdmin: (roles.data ?? []).some((r) => r.role === 'admin'),
    restaurants: (members.data ?? []).flatMap((m: any) =>
      m.restaurants ? [{ id: m.restaurants.id, name: m.restaurants.name, status: m.restaurants.status, role: m.role }] : []),
  };
}

export async function requireViewer(next: string): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect(`/login?next=${encodeURIComponent(next)}`);
  return viewer;
}
