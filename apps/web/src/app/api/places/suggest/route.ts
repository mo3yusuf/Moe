import { NextResponse, type NextRequest } from 'next/server';
import { placesEnabled, suggestPlaces } from '@/lib/places';
import { supabaseServer } from '@/lib/supabase/server';

/** Address suggestions while typing (signed-in users only, so the Google key can't be used by others). */
export async function GET(req: NextRequest) {
  if (!placesEnabled()) return NextResponse.json({ enabled: false, suggestions: [] });
  const { data: { user } } = await (await supabaseServer()).auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 120);
  const s = (req.nextUrl.searchParams.get('s') ?? '').slice(0, 64);
  if (q.length < 3 || !s) return NextResponse.json({ enabled: true, suggestions: [] });
  try {
    return NextResponse.json({ enabled: true, suggestions: await suggestPlaces(q, s) });
  } catch (e) {
    console.error('[places] suggest failed', e);
    return NextResponse.json({ enabled: true, suggestions: [], error: 'Address search is unavailable — type the address below.' });
  }
}
