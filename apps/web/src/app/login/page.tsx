import { LoginForm } from './login-form';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="container" style={{ maxWidth: 420 }}>
      <div className="card stack" style={{ marginTop: 48 }}>
        <h1 style={{ margin: 0 }}>Sign in</h1>
        <p className="muted" style={{ margin: 0 }}>Use the same account as the CRAVE app.</p>
        <LoginForm next={next ?? '/'} />
      </div>
    </main>
  );
}
