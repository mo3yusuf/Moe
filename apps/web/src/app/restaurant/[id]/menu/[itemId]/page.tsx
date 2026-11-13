import { ALLERGEN_LABELS, ALLERGENS, CUISINES, DIETARY_LABELS, DIETARY_TAGS, formatMoney, titleCase } from '@crave/core';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadMemberRestaurant } from '@/lib/restaurant';
import { addOptionGroup, deleteItem, deleteOptionGroup, updateItem } from '../actions';
import { ItemForm } from '../item-form';
import { ImageUpload } from './image-upload';
import { OptionGroupForm } from './option-group-form';

const STYLE_LABEL: Record<string, string> = { list: 'List', chips: 'Chips', remove: 'Remove ingredients' };

export default async function ItemPage({ params }: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = await params;
  const { supabase } = await loadMemberRestaurant(id);
  const { data: item } = await supabase.from('menu_items')
    .select('*, menu_item_option_groups(id, name, min_select, max_select, sort_order, display_style, parent_option_id, menu_item_options(id, name, price_delta_cents, max_quantity, image_url, linked_menu_item_id, sort_order))')
    .eq('id', itemId).eq('restaurant_id', id).maybeSingle();
  if (!item) notFound();
  const groups = [...(item.menu_item_option_groups ?? [])].sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const optionName = new Map<string, string>(groups.flatMap((g: any) => (g.menu_item_options ?? []).map((o: any) => [o.id, o.name] as [string, string])));
  const parents = groups.filter((g: any) => !g.parent_option_id).flatMap((g: any) => (g.menu_item_options ?? []).map((o: any) => ({ id: o.id, label: `${g.name}: ${o.name}` })));
  return (
    <div className="stack">
      <Link href={`/restaurant/${id}/menu`} className="muted">← Back to menu</Link>
      <div className="card stack">
        <h2 style={{ margin: 0 }}>{item.name}</h2>
        <ItemForm action={updateItem.bind(null, id, itemId)} submitLabel="Save changes"
          cuisines={CUISINES.map((c) => [c, titleCase(c)])} dietary={DIETARY_TAGS.map((d) => [d, DIETARY_LABELS[d]])} allergens={ALLERGENS.map((a) => [a, ALLERGEN_LABELS[a]])}
          defaults={{ ...item, price: (item.price_cents / 100).toFixed(2), dietary: item.dietary_tags, spice: item.spice_level, gstFree: !item.gst_applicable, isCombo: item.is_combo }} />
      </div>
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Photo</h2>
        <ImageUpload restaurantId={id} itemId={itemId} current={item.image_url} />
      </div>
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Customisations</h2>
        <p className="muted" style={{ margin: 0 }}>Like Uber Eats: sizes, extras with quantities, “remove ingredients”, nested choices (e.g. Fries → sauce) and meal-deal picks.</p>
        {groups.map((g: any) => (
          <div key={g.id} className="card stack" style={{ background: 'var(--surface-2)', marginLeft: g.parent_option_id ? 24 : 0 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>
                {g.parent_option_id ? `↳ ` : ''}{g.name}{' '}
                <span className="muted">
                  ({STYLE_LABEL[g.display_style] ?? 'List'} · {g.min_select === 0 ? 'optional' : `choose at least ${g.min_select}`}, max {g.max_select}
                  {g.parent_option_id ? ` · only when “${optionName.get(g.parent_option_id) ?? '…'}” is picked` : ''})
                </span>
              </strong>
              <form action={deleteOptionGroup.bind(null, id, itemId, g.id)}><button className="btn danger" style={{ minHeight: 34 }}>Remove</button></form>
            </div>
            <div className="muted">{(g.menu_item_options ?? []).sort((a: any, b: any) => a.sort_order - b.sort_order).map((o: any) =>
              `${o.image_url ? '📷 ' : ''}${o.name}${o.price_delta_cents ? ` (+${formatMoney(o.price_delta_cents)})` : ''}${o.max_quantity > 1 ? ` · up to ${o.max_quantity}` : ''}${o.linked_menu_item_id ? ' · linked dish' : ''}`).join(' · ')}</div>
          </div>
        ))}
        <OptionGroupForm action={addOptionGroup.bind(null, id, itemId)} parents={parents} />
      </div>
      <form action={deleteItem.bind(null, id, itemId)}><button className="btn danger">Delete item</button></form>
    </div>
  );
}
