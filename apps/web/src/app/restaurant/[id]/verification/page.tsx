import { formatAbn } from '@crave/core';
import { canManage, loadMemberRestaurant } from '@/lib/restaurant';
import { VerificationForm } from './verification-form';

export default async function VerificationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, restaurant, role } = await loadMemberRestaurant(id);
  const { data: history } = await supabase.from('restaurant_verifications').select('id, status, submitted_at, reviewer_notes, decided_at').eq('restaurant_id', id).order('submitted_at', { ascending: false });
  const latest = history?.[0];
  return (
    <div className="stack">
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Verification</h2>
        <p className="muted" style={{ margin: 0 }}>Legal name: {restaurant.legal_name ?? '—'} · ABN {restaurant.abn ? formatAbn(restaurant.abn) : '—'}</p>
        <p className="muted" style={{ margin: 0 }}>CRAVE checks your ABN on the Australian Business Register, your food business licence, and that you are authorised to list this business.</p>
        {(history ?? []).map((h) => (
          <div key={h.id} className="row"><span className={`badge ${h.status === 'approved' ? 'ok' : h.status === 'rejected' ? 'bad' : 'warn'}`}>{h.status.replace(/_/g, ' ')}</span>
            <span className="muted">submitted {new Date(h.submitted_at).toLocaleDateString('en-AU')}{h.reviewer_notes ? ` — ${h.reviewer_notes}` : ''}</span></div>
        ))}
      </div>
      {canManage(role) && restaurant.status !== 'verified' && (!latest || ['rejected', 'more_info_required'].includes(latest.status)) ? (
        <div className="card stack"><h2 style={{ margin: 0 }}>Submit documents</h2><VerificationForm restaurantId={id} /></div>
      ) : null}
    </div>
  );
}
