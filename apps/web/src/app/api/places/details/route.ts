import { NextResponse, type NextRequest } from 'next/server';
import { placeAddress, placesEnabled } from '@/lib/places';
import { supabaseServer } from '@/lib/supabase/server';

/** The chosen suggestion's street, suburb, postcode and exact location. */
export async function GET(req: NextRequest) {
  if (!placesEnabled()) return NextResponse.json({ enabled: false }, { status: 404 });
  const { data: { user } } = await (await supabaseServer()).auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  const id = req.nextUrl.searchParams.get('id') ?? '';
  const s = (req.nextUrl.searchParams.get('s') ?? '').slice(0, 64);
  try {
    const address = await placeAddress(id, s);
    return address ? NextResponse.json({ address }) : NextResponse.json({ error: 'Address not found' }, { status: 404 });
  } catch (e) {
    console.error('[places] details failed', e);
    return NextResponse.json({ error: 'Couldn’t load that address — type it below instead.' }, { status: 502 });
  }
}
