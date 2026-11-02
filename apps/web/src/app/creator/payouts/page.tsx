/** Return/refresh page for creator Stripe onboarding opened from the mobile app. */
export default async function CreatorPayouts({ searchParams }: { searchParams: Promise<{ done?: string; refresh?: string }> }) {
  const sp = await searchParams;
  return (
    <main className="container" style={{ maxWidth: 480 }}>
      <div className="card stack" style={{ marginTop: 48 }}>
        <h1 style={{ margin: 0 }}>{sp.refresh ? 'Link expired' : 'Thanks!'}</h1>
        <p className="muted" style={{ margin: 0 }}>
          {sp.refresh
            ? 'Your Stripe setup link expired. Go back to the CRAVE app and tap “Finish payout setup” again.'
            : 'Stripe is checking your details. You can close this page and return to the CRAVE app — your earnings screen updates once Stripe approves your account.'}
        </p>
      </div>
    </main>
  );
}
