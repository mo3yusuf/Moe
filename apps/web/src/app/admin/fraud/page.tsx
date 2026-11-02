import { supabaseServer } from '@/lib/supabase/server';
import { resolveFlag, runFraudRules } from '../actions';

const RULES: Record<string, string> = {
  refunds_30d: 'Customer had 3+ refunds in 30 days',
  order_velocity_1h: 'Customer created 6+ orders within an hour',
  high_rejection_rate: 'Restaurant declined/cancelled 30%+ of recent orders',
  failed_payments_24h: '3+ failed payments in 24 hours (possible card testing)',
};

export default async function Fraud() {
  const supabase = await supabaseServer();
  const { data } = await supabase.from('fraud_flags').select('*').order('status').order('created_at', { ascending: false }).limit(200);
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>Fraud flags</h1>
        <form action={runFraudRules}><button className="btn secondary">Run checks now</button></form>
      </div>
      <p className="muted" style={{ margin: 0 }}>Rules only raise flags for a person to review — nothing is blocked automatically. Schedule <code>run_fraud_rules()</code> hourly (pg_cron) in production.</p>
      <table><thead><tr><th>Raised</th><th>Entity</th><th>Rule</th><th>Details</th><th>Status</th><th>Action</th></tr></thead><tbody>
        {(data ?? []).map((f) => (
          <tr key={f.id}>
            <td>{new Date(f.created_at).toLocaleString('en-AU')}</td>
            <td>{f.entity_type}<div className="muted" style={{ fontSize: 12 }}>{f.entity_id}</div></td>
            <td><span className={`badge ${f.severity === 'high' ? 'bad' : 'warn'}`}>{f.severity}</span> {RULES[f.rule] ?? f.rule}</td>
            <td className="muted" style={{ fontSize: 12 }}>{JSON.stringify(f.details)}</td>
            <td>{f.status}</td>
            <td>{['open', 'investigating'].includes(f.status) ? (
              <form className="row" style={{ flexWrap: 'nowrap' }} action={resolveFlag.bind(null, f.id, 'resolved')}>
                <input name="notes" placeholder="Notes" />
                <button className="btn secondary" style={{ minHeight: 34 }}>Resolved</button>
                <button className="btn secondary" style={{ minHeight: 34 }} formAction={resolveFlag.bind(null, f.id, 'false_positive')}>False positive</button>
                {f.status === 'open' ? <button className="btn secondary" style={{ minHeight: 34 }} formAction={resolveFlag.bind(null, f.id, 'investigating')}>Investigating</button> : null}
              </form>
            ) : null}</td>
          </tr>
        ))}
      </tbody></table>
    </div>
  );
}
