import type { Metadata } from 'next';
import { SignUpForm } from './signup-form';

export const metadata: Metadata = { title: 'Create a business account · CRAVE' };

export default function SignUpPage() {
  return (
    <main className="container" style={{ maxWidth: 460 }}>
      <div className="card stack" style={{ marginTop: 40, gap: 16 }}>
        <div className="stack" style={{ gap: 6 }}>
          <h1 style={{ margin: 0 }}>Create your business account</h1>
          <p className="muted" style={{ margin: 0 }}>Free to join. It takes about 15 minutes to set up your store, and you can save and come back any time.</p>
        </div>
        <SignUpForm />
      </div>
    </main>
  );
}
