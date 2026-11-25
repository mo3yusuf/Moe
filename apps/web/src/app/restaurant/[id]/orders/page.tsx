import { loadMemberRestaurant } from '@/lib/restaurant';
import { OrdersBoard } from './orders-board';
import { ORDER_COLUMNS, type BoardOrder } from './shared';

export default async function OrdersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await loadMemberRestaurant(id);
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const [{ data: orders }, { data: loc }] = await Promise.all([
    supabase.from('orders').select(ORDER_COLUMNS)
      .eq('restaurant_id', id).neq('status', 'pending_payment').gte('created_at', since).order('created_at', { ascending: false }),
    supabase.from('restaurant_locations').select('id, prep_time_minutes, is_accepting_orders').eq('restaurant_id', id).order('created_at').limit(1).maybeSingle(),
  ]);
  return (
    <OrdersBoard
      restaurantId={id}
      initialOrders={(orders ?? []) as unknown as BoardOrder[]}
      location={loc ? { id: loc.id, prepMinutes: loc.prep_time_minutes, accepting: loc.is_accepting_orders } : null}
    />
  );
}
