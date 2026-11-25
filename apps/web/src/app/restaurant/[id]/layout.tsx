import type { ReactNode } from 'react';
import { loadMemberRestaurant } from '@/lib/restaurant';
import { NavTabs } from './nav-tabs';

const STATUS: Record<string, [string, string]> = {
  verified: ['Live on CRAVE', 'ok'], pending_verification: ['Under review', 'warn'], draft: ['Setting up', ''],
  rejected: ['Not approved', 'bad'], suspended: ['Suspended', 'bad'],
};

export default async function RestaurantShell({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, restaurant, role } = await loadMemberRestaurant(id);
  const base = `/restaurant/${id}`;
  const { count: newOrders } = await supabase.from('orders').select('id', { count: 'exact', head: true }).eq('restaurant_id', id).eq('status', 'placed');
  const [statusLabel, statusTone] = STATUS[restaurant.status] ?? [restaurant.status.replace('_', ' '), ''];
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="stack" style={{ gap: 4, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 'clamp(24px, 5vw, 32px)' }}>{restaurant.name}</h1>
          <div className="row" style={{ gap: 8 }}><span className={`badge ${statusTone}`}>{statusLabel}</span><span className="muted" style={{ fontSize: 14 }}>You’re {role === 'owner' ? 'the owner' : `a ${role}`}</span></div>
        </div>
      </div>
      <NavTabs base={base} showSetup={restaurant.status !== 'verified'} newOrders={newOrders ?? 0} />
      {children}
    </div>
  );
}
