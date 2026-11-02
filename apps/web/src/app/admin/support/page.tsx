import { supabaseServer } from '@/lib/supabase/server';
import { setTicketStatus } from '../actions';

export default async function Support() {
  const supabase = await supabaseServer();
  const { data } = await supabase.from('support_tickets').select('id, subject, body, status, created_at, restaurants(name), orders(order_number)').order('status').order('created_at', { ascending: false }).limit(100);
  return (
    <div className="stack">
      <h1 style={{ margin: 0 }}>Support requests</h1>
      {(data ?? []).length === 0 ? <p className="muted">No requests.</p> : (data ?? []).map((t: any) => (
        <div key={t.id} className="card stack">
          <div className="row" style={{ justifyContent: 'space-between' }}><strong>{t.subject}</strong><span className="badge">{t.status}</span></div>
          <div className="muted">{t.restaurants?.name ?? 'Customer'}{t.orders?.order_number ? ` · ${t.orders.order_number}` : ''} · {new Date(t.created_at).toLocaleString('en-AU')}</div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{t.body}</div>
          <div className="row">{['pending', 'resolved', 'closed'].filter((s) => s !== t.status).map((s) => (
            <form key={s} action={setTicketStatus.bind(null, t.id, s)}><button className="btn secondary" style={{ minHeight: 34 }}>Mark {s}</button></form>
          ))}</div>
        </div>
      ))}
    </div>
  );
}
