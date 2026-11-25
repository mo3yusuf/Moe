import Link from 'next/link';
import { getViewer } from '@/lib/viewer';
import { isConfigured } from '@/lib/env';

const STEPS = [
  ['Create your account', 'Sign up free in a minute with your email.'],
  ['Set up your store', 'Add your opening hours and menu, connect your bank through Stripe, and upload your documents.'],
  ['Start getting orders', 'Once CRAVE approves your store, customers find your dishes in videos and order for pickup.'],
];
const BENEFITS = [
  ['🎬', 'Discovered through video', 'Customers swipe through short videos of real dishes — yours included — and order what they crave. No filming needed: food creators feature you.'],
  ['🔔', 'An orders screen that rings', 'Run CRAVE on any tablet or phone at the counter. New orders ring until you accept, with one tap to set the prep time.'],
  ['💸', 'Paid straight to your bank', 'Stripe sends your share of every order to your bank account automatically. See every payout in your dashboard.'],
  ['📈', 'Know what sells', 'See your sales, top dishes and which videos brought in orders.'],
];
const FAQ = [
  ['What does it cost?', 'Nothing to join and no monthly fee. CRAVE takes a commission on each order placed through CRAVE (shown in your dashboard before you go live). Card processing is included.'],
  ['Do I need to make videos?', 'No. List your menu with photos. Food creators post videos of your dishes, and you approve which dish each video is linked to.'],
  ['What do I need to sign up?', 'Your ABN, your food business licence, and a bank account for payouts.'],
  ['Pickup or delivery?', 'Pickup today. Delivery through a delivery partner is coming.'],
];

export default async function Home() {
  const viewer = isConfigured ? await getViewer() : null;
  const primary = viewer
    ? viewer.restaurants.length ? { href: '/restaurant', label: 'Open your dashboard' } : { href: '/restaurant/onboarding', label: 'Set up your restaurant' }
    : { href: '/signup', label: 'Get started — it’s free' };

  return (
    <main className="container stack" style={{ gap: 48 }}>
      <section className="hero">
        <span className="badge ok" style={{ alignSelf: "flex-start" }}>For restaurants in Brisbane</span>
        <h1>Turn food videos<br />into orders.</h1>
        <p className="muted">CRAVE is where hungry people swipe through videos of real dishes — and order them. Put your restaurant in front of them.</p>
        <div className="row">
          <Link className="btn big" href={primary.href}>{primary.label}</Link>
          {viewer?.isAdmin ? <Link className="btn secondary" href="/admin">Admin console</Link> : null}
          {!viewer ? <Link className="btn secondary" href="/login">Sign in</Link> : null}
        </div>
      </section>

      <section className="stack" aria-labelledby="how">
        <h2 id="how" className="section-title">How it works</h2>
        <ol className="steps">
          {STEPS.map(([t, d], i) => (
            <li key={t} className="card stack" style={{ gap: 6 }}>
              <span className="step-num">{i + 1}</span>
              <strong style={{ fontSize: 18 }}>{t}</strong>
              <span className="muted">{d}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="stack" aria-labelledby="why">
        <h2 id="why" className="section-title">Why restaurants join CRAVE</h2>
        <div className="grid">
          {BENEFITS.map(([icon, t, d]) => (
            <div key={t} className="card stack" style={{ gap: 6 }}>
              <span style={{ fontSize: 28 }} aria-hidden>{icon}</span>
              <strong style={{ fontSize: 17 }}>{t}</strong>
              <span className="muted">{d}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="stack" aria-labelledby="faq">
        <h2 id="faq" className="section-title">Questions</h2>
        <div className="stack" style={{ gap: 8 }}>
          {FAQ.map(([q, a]) => (
            <details key={q} className="card">
              <summary style={{ cursor: 'pointer', fontWeight: 700 }}>{q}</summary>
              <p className="muted" style={{ marginBottom: 0 }}>{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="card stack" style={{ alignItems: 'center', textAlign: 'center', padding: 32 }}>
        <h2 style={{ margin: 0 }}>Ready to get started?</h2>
        <p className="muted" style={{ margin: 0 }}>Set up takes about 15 minutes. You can save and come back any time.</p>
        <Link className="btn big" href={primary.href}>{primary.label}</Link>
      </section>
    </main>
  );
}
