import Link from 'next/link';
import type { ReactNode } from 'react';
import { loadMemberRestaurant } from '@/lib/restaurant';

const BADGE: Record<string, string> = { verified: 'ok', pending_verification: 'warn', rejected: 'bad', suspended: 'bad' };

export default async function RestaurantShell({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { restaurant, role } = await loadMemberRestaurant(id);
  const base = `/restaurant/${id}`;
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="stack" style={{ gap: 4 }}>
          <h1 style={{ margin: 0 }}>{restaurant.name}</h1>
          <div className="row"><span className={`badge ${BADGE[restaurant.status] ?? ''}`}>{restaurant.status.replace('_', ' ')}</span><span className="muted">Your role: {role}</span></div>
        </div>
      </div>
      <nav className="row" aria-label="Restaurant sections">
        {[['', 'Overview'], ['/orders', 'Orders'], ['/sales', 'Sales'], ['/payouts', 'Payouts'], ['/menu', 'Menu'], ['/hours', 'Hours & availability'], ['/content', 'Videos & creator tags'], ['/verification', 'Verification'], ['/support', 'Support']].map(([p, l]) => (
          <Link key={p} href={`${base}${p}`} className="btn secondary">{l}</Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
