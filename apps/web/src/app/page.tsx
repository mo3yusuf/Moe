import Link from 'next/link';
import { getViewer } from '@/lib/viewer';
import { isConfigured } from '@/lib/env';

export default async function Home() {
  const viewer = isConfigured ? await getViewer() : null;
  return (
    <main className="container stack" style={{ gap: 24 }}>
      <h1 style={{ fontSize: 40, margin: '24px 0 0' }}>Turn food videos into orders.</h1>
      <p className="muted" style={{ maxWidth: 640, fontSize: 18 }}>
        List your menu on CRAVE — no filming required. Customers in Brisbane discover your dishes through creator videos and order for pickup.
      </p>
      {viewer ? (
        <div className="row">
          {viewer.restaurants.length ? <Link className="btn" href="/restaurant">Open restaurant dashboard</Link>
            : <Link className="btn" href="/restaurant/onboarding">Register your restaurant</Link>}
          {viewer.isAdmin ? <Link className="btn secondary" href="/admin">Admin console</Link> : null}
        </div>
      ) : (
        <div className="row"><Link className="btn" href="/login">Sign in to get started</Link></div>
      )}
    </main>
  );
}
