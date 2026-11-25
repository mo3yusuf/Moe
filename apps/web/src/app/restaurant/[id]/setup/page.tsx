import { ALLERGENS, CUISINES, DIETARY_TAGS, formatMoney, titleCase } from '@crave/core';
import Link from 'next/link';
import { canManage, loadMemberRestaurant } from '@/lib/restaurant';
import { saveHours } from '../hours/actions';
import { HoursForm } from '../hours/hours-form';
import { addItem } from '../menu/actions';
import { ItemForm } from '../menu/item-form';
import { startOnboarding } from '../payouts/actions';
import { VerificationForm } from '../verification/verification-form';

/**
 * Store setup wizard (after "Register your restaurant"): hours → menu → get paid → documents.
 * Every step saves as you go; progress is worked out from what's already in the database, so owners
 * can leave and come back any time.
 */
type StepKey = 'details' | 'hours' | 'menu' | 'payouts' | 'verify';
const STEPS: { key: StepKey; label: string }[] = [
  { key: 'details', label: 'Store details' },
  { key: 'hours', label: 'Opening hours' },
  { key: 'menu', label: 'Menu' },
  { key: 'payouts', label: 'Get paid' },
  { key: 'verify', label: 'Documents' },
];

export default async function SetupPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ step?: string }> }) {
  const { id } = await params;
  const { step: rawStep } = await searchParams;
  const { supabase, restaurant, role } = await loadMemberRestaurant(id);
  const base = `/restaurant/${id}`;
  if (!canManage(role)) return <div className="card">Only the owner or a manager can set up the store.</div>;

  const [{ data: loc }, { data: items }, { data: verifications }] = await Promise.all([
    supabase.from('restaurant_locations').select('id, suburb, address_line1, location_opening_hours(*)').eq('restaurant_id', id).order('created_at').limit(1).maybeSingle(),
    supabase.from('menu_items').select('id, name, price_cents, section').eq('restaurant_id', id).order('created_at'),
    supabase.from('restaurant_verifications').select('status, submitted_at').eq('restaurant_id', id).order('submitted_at', { ascending: false }).limit(1),
  ]);
  const latestVerification = verifications?.[0];
  const done: Record<StepKey, boolean> = {
    details: true,
    hours: (loc?.location_opening_hours?.length ?? 0) > 0,
    menu: (items?.length ?? 0) > 0,
    payouts: !!restaurant.payouts_enabled,
    verify: restaurant.status === 'verified' || (!!latestVerification && !['rejected', 'more_info_required'].includes(latestVerification.status)),
  };
  const doneCount = STEPS.filter((s) => done[s.key]).length;
  const firstTodo = STEPS.find((s) => !done[s.key])?.key;
  const step: StepKey = (STEPS.some((s) => s.key === rawStep) ? rawStep : firstTodo ?? 'verify') as StepKey;
  const index = STEPS.findIndex((s) => s.key === step);
  const next = STEPS[index + 1];
  const allDone = doneCount === STEPS.length;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="card stack" style={{ gap: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>{allDone ? (restaurant.status === 'verified' ? 'Your store is live 🎉' : 'All done — we’re reviewing your store') : 'Set up your store'}</h2>
          <span className="muted">{doneCount} of {STEPS.length} done</span>
        </div>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={STEPS.length} aria-valuenow={doneCount}>
          <span style={{ width: `${(doneCount / STEPS.length) * 100}%` }} />
        </div>
        <ol className="stepper">
          {STEPS.map((s, i) => (
            <li key={s.key}>
              <Link href={`${base}/setup?step=${s.key}`} aria-current={s.key === step ? 'step' : undefined}>
                <span className={`tick ${done[s.key] ? 'done' : ''}`}>{done[s.key] ? '✓' : i + 1}</span>{s.label}
              </Link>
            </li>
          ))}
        </ol>
        {allDone ? (
          <p className="muted" style={{ margin: 0 }}>
            {restaurant.status === 'verified'
              ? 'Customers can now find and order from you. Keep the Orders screen open at the counter so you hear new orders.'
              : 'CRAVE is checking your documents — usually within 1–2 business days. We’ll email you when your store goes live. Meanwhile, set up the Orders screen on a tablet or phone at the counter.'}
          </p>
        ) : null}
      </div>

      {step === 'details' ? (
        <StepCard title="Store details" done intro="Your store’s name, address and cuisine were saved when you registered.">
          <p style={{ margin: 0 }}><strong>{restaurant.name}</strong>{loc ? <span className="muted"> · {loc.address_line1}, {loc.suburb}</span> : null}</p>
          <p className="muted" style={{ margin: 0 }}>Need to change these? Contact CRAVE support from the Support page.</p>
        </StepCard>
      ) : null}

      {step === 'hours' ? (
        <StepCard title="When are you open?" done={done.hours} intro="We filled in 11 am – 9 pm every day to start. Change them to your real hours — customers can only order while you’re open.">
          {loc ? <HoursForm action={saveHours.bind(null, id, loc.id)} hours={loc.location_opening_hours ?? []} /> : <p className="error">No location found. Contact CRAVE support.</p>}
        </StepCard>
      ) : null}

      {step === 'menu' ? (
        <StepCard title="Add your menu" done={done.menu} intro="Add your dishes with prices (GST inclusive). Start with your best sellers — you can add photos, sides and extras later in Menu.">
          {(items ?? []).length ? (
            <div className="stack" style={{ gap: 6 }}>
              <strong>{items!.length} dish{items!.length === 1 ? '' : 'es'} on your menu</strong>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {items!.slice(0, 12).map((i) => <li key={i.id}>{i.name} <span className="muted">· {formatMoney(i.price_cents)} · {i.section}</span></li>)}
              </ul>
              {items!.length > 12 ? <span className="muted">…and {items!.length - 12} more</span> : null}
            </div>
          ) : null}
          <ItemForm action={addItem.bind(null, id)} hidden={{ returnTo: 'setup' }} submitLabel="Add dish"
            cuisines={CUISINES.map((c) => [c, titleCase(c)])} dietary={DIETARY_TAGS.map((d) => [d, titleCase(d)])} allergens={ALLERGENS.map((a) => [a, titleCase(a)])} />
        </StepCard>
      ) : null}

      {step === 'payouts' ? (
        <StepCard title="Get paid" done={done.payouts}
          intro="CRAVE uses Stripe to take card payments and pay you. Stripe will ask for your business details, ID and bank account — CRAVE never sees your bank details.">
          {role !== 'owner' ? <p className="muted">Only the restaurant owner can connect the bank account.</p>
            : done.payouts ? <p style={{ color: 'var(--success)', margin: 0 }}>✓ Connected — you can take card orders.</p>
            : (
              <div className="stack">
                <p className="muted" style={{ margin: 0 }}>Your share of each order is the food price minus CRAVE’s {(restaurant.commission_rate_bps / 100).toFixed(1)}% commission. Stripe pays it into your bank account automatically.</p>
                <form action={startOnboarding.bind(null, id)}><button className="btn big">{restaurant.stripe_account_id ? 'Continue Stripe setup' : 'Connect your bank with Stripe'}</button></form>
                {restaurant.stripe_account_id ? <p className="muted" style={{ margin: 0 }}>Already finished on Stripe? It can take a minute to confirm — refresh this page.</p> : null}
              </div>
            )}
        </StepCard>
      ) : null}

      {step === 'verify' ? (
        <StepCard title="Upload your documents" done={done.verify}
          intro="CRAVE checks your ABN, your food business licence, and that you’re allowed to list this business. Your documents are stored privately.">
          {done.verify ? (
            <p style={{ margin: 0 }}>{restaurant.status === 'verified' ? '✓ Verified.' : `✓ Submitted${latestVerification ? ` on ${new Date(latestVerification.submitted_at).toLocaleDateString('en-AU')}` : ''} — we’ll email you once it’s reviewed.`}</p>
          ) : <VerificationForm restaurantId={id} />}
        </StepCard>
      ) : null}

      <div className="row" style={{ justifyContent: 'space-between' }}>
        {index > 0 ? <Link className="btn secondary" href={`${base}/setup?step=${STEPS[index - 1]!.key}`}>← Back</Link> : <span />}
        {next ? <Link className="btn" href={`${base}/setup?step=${next.key}`}>{done[step] ? 'Continue →' : 'Skip for now →'}</Link>
          : <Link className="btn" href={`${base}/orders`}>Go to the Orders screen →</Link>}
      </div>
    </div>
  );
}

function StepCard({ title, intro, done, children }: { title: string; intro: string; done: boolean; children: React.ReactNode }) {
  return (
    <section className="card stack" style={{ gap: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        <span className={`badge ${done ? 'ok' : ''}`}>{done ? 'Done' : 'To do'}</span>
      </div>
      <p className="muted" style={{ margin: 0 }}>{intro}</p>
      {children}
    </section>
  );
}
