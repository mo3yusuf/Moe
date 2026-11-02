import { CUISINES, DIETARY_LABELS, DIETARY_TAGS, formatMoney, titleCase } from '@crave/core';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadMemberRestaurant } from '@/lib/restaurant';
import { addOptionGroup, deleteItem, deleteOptionGroup, updateItem } from '../actions';
import { ItemForm } from '../item-form';
import { ImageUpload } from './image-upload';
import { OptionGroupForm } from './option-group-form';

export default async function ItemPage({ params }: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = await params;
  const { supabase } = await loadMemberRestaurant(id);
  const { data: item } = await supabase.from('menu_items')
    .select('*, menu_item_option_groups(id, name, min_select, max_select, menu_item_options(id, name, price_delta_cents))')
    .eq('id', itemId).eq('restaurant_id', id).maybeSingle();
  if (!item) notFound();
  return (
    <div className="stack">
      <Link href={`/restaurant/${id}/menu`} className="muted">← Back to menu</Link>
      <div className="card stack">
        <h2 style={{ margin: 0 }}>{item.name}</h2>
        <ItemForm action={updateItem.bind(null, id, itemId)} submitLabel="Save changes"
          cuisines={CUISINES.map((c) => [c, titleCase(c)])} dietary={DIETARY_TAGS.map((d) => [d, DIETARY_LABELS[d]])}
          defaults={{ ...item, price: (item.price_cents / 100).toFixed(2), dietary: item.dietary_tags, spice: item.spice_level, gstFree: !item.gst_applicable }} />
      </div>
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Photo</h2>
        <ImageUpload restaurantId={id} itemId={itemId} current={item.image_url} />
      </div>
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Customisations</h2>
        {(item.menu_item_option_groups ?? []).map((g: any) => (
          <div key={g.id} className="card stack" style={{ background: 'var(--surface-2)' }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{g.name} <span className="muted">({g.min_select === 0 ? 'optional' : `choose at least ${g.min_select}`}, max {g.max_select})</span></strong>
              <form action={deleteOptionGroup.bind(null, id, itemId, g.id)}><button className="btn danger" style={{ minHeight: 34 }}>Remove</button></form>
            </div>
            <div className="muted">{(g.menu_item_options ?? []).map((o: any) => `${o.name}${o.price_delta_cents ? ` (+${formatMoney(o.price_delta_cents)})` : ''}`).join(' · ')}</div>
          </div>
        ))}
        <OptionGroupForm action={addOptionGroup.bind(null, id, itemId)} />
      </div>
      <form action={deleteItem.bind(null, id, itemId)}><button className="btn danger">Delete item</button></form>
    </div>
  );
}
