import { formatAbn } from '@crave/core';
import { supabaseServer } from '@/lib/supabase/server';
import { decide } from './actions';

export default async function Verifications() {
  const supabase = await supabaseServer();
  const { data } = await supabase.from('restaurant_verifications')
    .select('id, status, submitted_at, document_paths, food_business_licence_number, restaurants(id, name, legal_name, abn, cuisines, restaurant_locations(address_line1, suburb, postcode, phone))')
    .in('status', ['submitted', 'in_review', 'more_info_required']).order('submitted_at');
  const rows = await Promise.all((data ?? []).map(async (v: any) => ({
    ...v,
    docs: await Promise.all((v.document_paths ?? []).map(async (p: string) => ({
      name: p.split('/').pop(), url: (await supabase.storage.from('verification-docs').createSignedUrl(p, 600)).data?.signedUrl,
    }))),
  })));
  return (
    <div className="stack">
      <h1 style={{ margin: 0 }}>Restaurant verification</h1>
      <p className="muted" style={{ margin: 0 }}>Check: ABN is active on abr.business.gov.au and matches the legal name; food business licence is current with the council; documents match the applicant.</p>
      {rows.length === 0 ? <p className="muted">Nothing awaiting review.</p> : rows.map((v) => {
        const r = v.restaurants; const loc = r?.restaurant_locations?.[0];
        return (
          <div key={v.id} className="card stack">
            <strong style={{ fontSize: 18 }}>{r?.name}</strong>
            <div className="muted">{r?.legal_name} · ABN {r?.abn ? formatAbn(r.abn) : '—'} · licence {v.food_business_licence_number ?? '—'}</div>
            <div className="muted">{loc ? `${loc.address_line1}, ${loc.suburb} ${loc.postcode} · ${loc.phone ?? 'no phone'}` : 'No location'}</div>
            <div className="row">{v.docs.map((d: any) => <a key={d.name} href={d.url} target="_blank" rel="noreferrer" className="btn secondary">{d.name}</a>)}</div>
            <form className="stack" action={decide.bind(null, v.id, true)}><button className="btn">Approve and publish restaurant</button></form>
            <form className="row" action={decide.bind(null, v.id, false)}>
              <input name="notes" placeholder="Reason for rejection (shown to the restaurant)" style={{ flex: 1 }} required />
              <button className="btn danger">Reject</button>
            </form>
          </div>
        );
      })}
    </div>
  );
}
