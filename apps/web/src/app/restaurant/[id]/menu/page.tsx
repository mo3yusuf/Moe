import { ALLERGEN_LABELS, ALLERGENS, CUISINES, DIETARY_LABELS, DIETARY_TAGS, titleCase } from '@crave/core';
import { canManage, loadMemberRestaurant } from '@/lib/restaurant';
import { addItem } from './actions';
import { ItemForm } from './item-form';
import { MenuList, type MenuRow } from './menu-list';

export default async function MenuPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, role } = await loadMemberRestaurant(id);
  const { data: items } = await supabase.from('menu_items').select('id, name, section, price_cents, is_available, image_url, dietary_tags, sold_out_until')
    .eq('restaurant_id', id).order('section').order('sort_order').order('name');
  const rows: MenuRow[] = (items ?? []).map((i) => ({
    id: i.id, name: i.name, section: i.section, price_cents: i.price_cents, is_available: i.is_available, image_url: i.image_url,
    sold_out_until: i.sold_out_until, dietary: (i.dietary_tags as string[]).map((t) => DIETARY_LABELS[t as keyof typeof DIETARY_LABELS] ?? t),
  }));
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="card"><MenuList restaurantId={id} items={rows} canEdit={canManage(role)} /></div>
      {canManage(role) ? (
        <details className="card stack" open={rows.length === 0}>
          <summary style={{ cursor: 'pointer', fontWeight: 800, fontSize: 18 }}>+ Add a dish</summary>
          <div style={{ marginTop: 12 }}>
            <ItemForm action={addItem.bind(null, id)} submitLabel="Add dish"
              cuisines={CUISINES.map((c) => [c, titleCase(c)])} dietary={DIETARY_TAGS.map((d) => [d, DIETARY_LABELS[d]])} allergens={ALLERGENS.map((a) => [a, ALLERGEN_LABELS[a]])} />
          </div>
        </details>
      ) : <p className="muted">You can mark dishes sold out. Ask an owner or manager to change prices or add dishes.</p>}
    </div>
  );
}
