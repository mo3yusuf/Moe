import Link from 'next/link';
import type { ReactNode } from 'react';
import { requireViewer } from '@/lib/viewer';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const viewer = await requireViewer('/admin');
  if (!viewer.isAdmin) {
    // Server-side gate. Data access is independently enforced by RLS (is_admin()).
    return <main className="container"><div className="card"><h1>Not authorised</h1><p className="muted">This area is for CRAVE administrators.</p></div></main>;
  }
  return (
    <div className="container layout">
      <nav className="side" aria-label="Admin">
        <Link href="/admin">Overview</Link>
        <Link href="/admin/verifications">Restaurant verification</Link>
        <Link href="/admin/videos">Video moderation</Link>
        <Link href="/admin/reports">Reports & appeals</Link>
        <Link href="/admin/orders">Orders</Link>
        <Link href="/admin/refunds">Refunds</Link>
        <Link href="/admin/users">Customers</Link>
        <Link href="/admin/creators">Creators</Link>
        <Link href="/admin/commission">Commission & fees</Link>
        <Link href="/admin/fraud">Fraud flags</Link>
        <Link href="/admin/recommendations">Recommendations</Link>
        <Link href="/admin/support">Support</Link>
      </nav>
      <main>{children}</main>
    </div>
  );
}
