import Link from 'next/link';
import type { ReactNode } from 'react';
import { requireViewer } from '@/lib/viewer';

export default async function RestaurantLayout({ children }: { children: ReactNode }) {
  const viewer = await requireViewer('/restaurant');
  return (
    <div className="container layout">
      <nav className="side" aria-label="Restaurant">
        <Link href="/restaurant">Overview</Link>
        {viewer.restaurants.map((r) => <Link key={r.id} href={`/restaurant/${r.id}`}>{r.name}</Link>)}
        <Link href="/restaurant/onboarding">+ Register a restaurant</Link>
        {viewer.restaurants.length === 0 ? <p className="muted" style={{ padding: 12 }}>No restaurants yet.</p> : null}
      </nav>
      <main>{children}</main>
    </div>
  );
}
