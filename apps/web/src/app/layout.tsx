import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { getViewer } from '@/lib/viewer';
import { isConfigured } from '@/lib/env';
import { signOut } from './login/actions';
import './globals.css';

export const metadata: Metadata = {
  title: 'CRAVE for Business',
  description: 'Restaurant and administrator dashboards for CRAVE.',
  robots: { index: false },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const viewer = isConfigured ? await getViewer() : null;
  return (
    <html lang="en-AU">
      <body>
        <nav className="top">
          <div className="container">
            <Link href="/" className="brand" style={{ fontSize: 22 }}>CRAVE <span className="muted" style={{ fontWeight: 600, fontSize: 14 }}>for Business</span></Link>
            <div className="row">
              {viewer?.restaurants.length ? <Link href="/restaurant">Restaurant</Link> : null}
              {viewer?.isAdmin ? <Link href="/admin">Admin</Link> : null}
              {viewer ? (
                <form action={signOut}><button className="btn secondary" type="submit">Sign out</button></form>
              ) : <Link className="btn" href="/login">Sign in</Link>}
            </div>
          </div>
        </nav>
        {!isConfigured ? (
          <div className="container"><p className="notice">Not connected: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see apps/web/.env.example).</p></div>
        ) : null}
        {children}
      </body>
    </html>
  );
}
