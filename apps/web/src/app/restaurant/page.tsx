import Link from 'next/link';
import { requireViewer } from '@/lib/viewer';

const STATUS_BADGE: Record<string, string> = { verified: 'ok', pending_verification: 'warn', draft: '', rejected: 'bad', suspended: 'bad' };

export default async function RestaurantHome() {
  const viewer = await requireViewer('/restaurant');
  if (viewer.restaurants.length === 0) {
    return (
      <div className="card stack">
        <h1 style={{ margin: 0 }}>Welcome to CRAVE for Business</h1>
        <p className="muted">You are not a member of any restaurant yet.</p>
        <div><Link className="btn" href="/restaurant/onboarding">Register your restaurant</Link></div>
      </div>
    );
  }
  return (
    <div className="stack">
      <h1 style={{ margin: 0 }}>Your restaurants</h1>
      <div className="grid">
        {viewer.restaurants.map((r) => (
          <div key={r.id} className="card stack">
            <strong style={{ fontSize: 18 }}>{r.name}</strong>
            <div className="row"><span className={`badge ${STATUS_BADGE[r.status] ?? ''}`}>{r.status.replace('_', ' ')}</span><span className="muted">{r.role}</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}
