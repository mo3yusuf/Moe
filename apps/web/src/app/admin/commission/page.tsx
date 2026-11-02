import { formatMoney, parseServiceFeeConfig } from '@crave/core';
import { supabaseServer } from '@/lib/supabase/server';
import { setCommission, setDefaultCommission, setServiceFee } from '../actions';

export default async function Commission() {
  const supabase = await supabaseServer();
  const [{ data: restaurants }, { data: settings }, { data: history }] = await Promise.all([
    supabase.from('restaurants').select('id, name, status, commission_rate_bps').order('name'),
    supabase.from('platform_settings').select('key, value').in('key', ['default_commission_bps', 'service_fee']),
    supabase.from('audit_log').select('created_at, action, entity_id, details').in('action', ['commission_changed', 'setting_changed']).order('created_at', { ascending: false }).limit(20),
  ]);
  const def = Number(settings?.find((s) => s.key === 'default_commission_bps')?.value ?? 1000);
  const fee = parseServiceFeeConfig(settings?.find((s) => s.key === 'service_fee')?.value);
  return (
    <div className="stack">
      <h1 style={{ margin: 0 }}>Commission & fees</h1>
      <div className="grid">
        <form action={setDefaultCommission} className="card stack">
          <h2 style={{ margin: 0 }}>Default commission</h2>
          <p className="muted" style={{ margin: 0 }}>Applied to newly registered restaurants. Existing agreements are unchanged.</p>
          <label>Percent<input name="percent" type="number" step="0.1" min={0} max={50} defaultValue={def / 100} /></label>
          <div><button className="btn secondary">Save default</button></div>
        </form>
        <form action={setServiceFee} className="card stack">
          <h2 style={{ margin: 0 }}>Customer service fee</h2>
          <p className="muted" style={{ margin: 0 }}>Currently {formatMoney(fee.fixedCents)} + {fee.percentBps / 100}% (min {formatMoney(fee.minCents)}, max {formatMoney(fee.maxCents)}). GST inclusive. Must be shown before checkout (ACL).</p>
          <div className="grid">
            <label>Fixed $<input name="fixed" type="number" step="0.01" defaultValue={fee.fixedCents / 100} /></label>
            <label>Percent<input name="percent" type="number" step="0.1" defaultValue={fee.percentBps / 100} /></label>
            <label>Min $<input name="min" type="number" step="0.01" defaultValue={fee.minCents / 100} /></label>
            <label>Max $<input name="max" type="number" step="0.01" defaultValue={fee.maxCents / 100} /></label>
          </div>
          <div><button className="btn secondary">Save service fee</button></div>
        </form>
      </div>
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Restaurant agreements</h2>
        <table><thead><tr><th>Restaurant</th><th>Status</th><th>Commission</th><th>Change (reason required)</th></tr></thead><tbody>
          {(restaurants ?? []).map((r) => (
            <tr key={r.id}><td>{r.name}</td><td>{r.status}</td><td>{(r.commission_rate_bps / 100).toFixed(1)}%</td>
              <td><form action={setCommission.bind(null, r.id)} className="row" style={{ flexWrap: 'nowrap' }}>
                <input name="percent" type="number" step="0.1" min={0} max={50} placeholder="%" style={{ width: 80 }} required />
                <input name="reason" placeholder="e.g. Launch partner, 3-month offer" required />
                <button className="btn secondary" style={{ minHeight: 34 }}>Update</button>
              </form></td></tr>
          ))}
        </tbody></table>
      </div>
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Change history</h2>
        <table><tbody>{(history ?? []).map((h, i) => <tr key={i}><td>{new Date(h.created_at).toLocaleString('en-AU')}</td><td>{h.action}</td><td className="muted">{JSON.stringify(h.details)}</td></tr>)}</tbody></table>
      </div>
    </div>
  );
}
