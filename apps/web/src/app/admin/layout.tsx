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
      </nav>
      <main>{children}</main>
    </div>
  );
}
