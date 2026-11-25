import Link from 'next/link';
import { LoginForm } from './login-form';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <main className="container" style={{ maxWidth: 420 }}>
      <div className="card stack" style={{ marginTop: 48 }}>
        <h1 style={{ margin: 0 }}>Sign in</h1>
        <p className="muted" style={{ margin: 0 }}>Use the same account as the CRAVE app.</p>
        {error === 'link' ? <p className="error" role="alert">That email link has expired or was already used. Request a new one below.</p> : null}
        <LoginForm next={next ?? '/'} />
        <Link href="/forgot-password" className="muted">Forgot your password?</Link>
        <p className="muted" style={{ margin: 0 }}>New restaurant partner? <Link href="/signup">Create a business account</Link></p>
      </div>
    </main>
  );
}
