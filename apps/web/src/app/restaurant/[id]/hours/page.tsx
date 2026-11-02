import { canManage, loadMemberRestaurant } from '@/lib/restaurant';
import { saveHours, saveSettings, setAccepting } from './actions';
import { HoursForm } from './hours-form';

export default async function HoursPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, restaurant, role } = await loadMemberRestaurant(id);
  const { data: loc } = await supabase.from('restaurant_locations').select('*, location_opening_hours(*)').eq('restaurant_id', id).limit(1).maybeSingle();
  if (!loc) return <div className="card">No location set up yet.</div>;
  const { data: open } = await supabase.rpc('location_is_open', { p_location_id: loc.id });
  return (
    <div className="stack">
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Taking orders</h2>
        <p className="muted" style={{ margin: 0 }}>Right now: {open ? 'within opening hours' : 'outside opening hours'} · {loc.is_accepting_orders ? 'accepting orders' : 'PAUSED'}</p>
        <form action={setAccepting.bind(null, id, loc.id, !loc.is_accepting_orders)}>
          <button className={`btn ${loc.is_accepting_orders ? 'danger' : ''}`}>{loc.is_accepting_orders ? 'Pause new orders (busy)' : 'Resume taking orders'}</button>
        </form>
      </div>
      {canManage(role) ? (
        <>
          <div className="card stack"><h2 style={{ margin: 0 }}>Opening hours — {loc.suburb}</h2><HoursForm action={saveHours.bind(null, id, loc.id)} hours={loc.location_opening_hours ?? []} /></div>
          <form action={saveSettings.bind(null, id, loc.id)} className="card stack">
            <h2 style={{ margin: 0 }}>Pickup settings</h2>
            <label>Typical prep time (minutes)<input name="prep" type="number" min={5} max={120} defaultValue={loc.prep_time_minutes} /></label>
            <label style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><input type="checkbox" name="pickup" defaultChecked={loc.pickup_enabled} style={{ width: 18, minHeight: 18 }} /> Offer pickup</label>
            <label style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><input type="checkbox" name="advance" defaultChecked={restaurant.accepts_advance_orders} style={{ width: 18, minHeight: 18 }} /> Accept advance orders while closed</label>
            <div><button className="btn secondary">Save settings</button></div>
          </form>
        </>
      ) : null}
    </div>
  );
}
