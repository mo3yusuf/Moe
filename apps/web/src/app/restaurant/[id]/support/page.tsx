import { loadMemberRestaurant } from '@/lib/restaurant';
import { openTicket } from './actions';
import { TicketForm } from './ticket-form';

export default async function SupportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await loadMemberRestaurant(id);
  const { data: tickets } = await supabase.from('support_tickets').select('id, subject, status, created_at').eq('restaurant_id', id).order('created_at', { ascending: false });
  return (
    <div className="stack">
      <div className="card stack"><h2 style={{ margin: 0 }}>Contact CRAVE support</h2><TicketForm action={openTicket.bind(null, id)} /></div>
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Your requests</h2>
        {(tickets ?? []).length === 0 ? <p className="muted">None yet.</p> : (
          <table><thead><tr><th>Subject</th><th>Status</th><th>Opened</th></tr></thead><tbody>
            {(tickets ?? []).map((t) => <tr key={t.id}><td>{t.subject}</td><td>{t.status}</td><td>{new Date(t.created_at).toLocaleDateString('en-AU')}</td></tr>)}
          </tbody></table>
        )}
      </div>
    </div>
  );
}
