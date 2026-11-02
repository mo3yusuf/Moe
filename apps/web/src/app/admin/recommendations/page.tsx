import { supabaseServer } from '@/lib/supabase/server';

const pct = (n: number | string | null) => `${(Number(n ?? 0) * 100).toFixed(1)}%`;

export default async function Recommendations({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const days = [7, 14, 30].includes(Number((await searchParams).days)) ? Number((await searchParams).days) : 14;
  const supabase = await supabaseServer();
  const [{ data, error }, { data: weights }] = await Promise.all([
    supabase.rpc('recommendation_performance', { p_days: days }),
    supabase.from('platform_settings').select('value, updated_at').eq('key', 'ranking_weights').maybeSingle(),
  ]);
  return (
    <div className="stack">
      <h1 style={{ margin: 0 }}>Recommendation performance</h1>
      <p className="muted" style={{ margin: 0 }}>
        Outcomes within 24 hours of an item being shown, for users who consented to personalisation. Compare model versions before changing weights;
        exploration slots are expected to score lower but keep feeds diverse.
      </p>
      <div className="row">{[7, 14, 30].map((d) => <a key={d} href={`?days=${d}`} className={`btn ${d === days ? '' : 'secondary'}`}>{d} days</a>)}</div>
      {error ? <p className="error">{error.message}</p> : (
        <table><thead><tr><th>Model</th><th>Slot</th><th>Impressions</th><th>Users</th><th>Crave rate</th><th>Not-for-me rate</th><th>Completion</th><th>Order rate</th></tr></thead><tbody>
          {(data ?? []).length === 0 ? <tr><td colSpan={8} className="muted">No impressions logged in this period.</td></tr> : (data ?? []).map((r: any) => (
            <tr key={`${r.model_version}-${r.is_exploration}`}><td>{r.model_version}</td><td>{r.is_exploration ? 'Exploration' : 'Personalised'}</td>
              <td>{r.impressions}</td><td>{r.users}</td><td>{pct(r.right_swipe_rate)}</td><td>{pct(r.left_swipe_rate)}</td><td>{pct(r.completion_rate)}</td><td>{pct(r.order_rate)}</td></tr>
          ))}
        </tbody></table>
      )}
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Weight overrides</h2>
        <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(weights?.value ?? {}, null, 2)}</pre>
        <p className="muted" style={{ margin: 0 }}>Empty means engine defaults (see packages/core/src/recommend/config.ts). Edit via <code>admin_set_setting('ranking_weights', …)</code>; set a new <code>modelVersion</code> with each change so results can be compared.</p>
      </div>
    </div>
  );
}
