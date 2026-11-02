import { ALLERGEN_LABELS, ALLERGENS, CUISINES, DIETARY_LABELS, DIETARY_TAGS, formatMoney, titleCase } from '@crave/core';
import Link from 'next/link';
import { canManage, loadMemberRestaurant } from '@/lib/restaurant';
import { addItem, toggleAvailability } from './actions';
import { ItemForm } from './item-form';

export default async function MenuPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, role } = await loadMemberRestaurant(id);
  const { data: items } = await supabase.from('menu_items').select('id, name, section, price_cents, is_available, image_url, dietary_tags').eq('restaurant_id', id).order('section').order('sort_order').order('name');
  const sections = Object.entries((items ?? []).reduce<Record<string, NonNullable<typeof items>>>((acc, i) => ((acc[i.section] ??= []).push(i), acc), {}));
  return (
    <div className="stack">
      {sections.length === 0 ? <p className="muted">No menu items yet.</p> : sections.map(([section, rows]) => (
        <div key={section} className="card stack">
          <h2 style={{ margin: 0 }}>{section}</h2>
          <table><thead><tr><th>Item</th><th>Price</th><th>Photo</th><th>Dietary</th><th>Available</th></tr></thead>
            <tbody>{rows.map((i) => (
              <tr key={i.id}>
                <td>{canManage(role) ? <Link href={`/restaurant/${id}/menu/${i.id}`}>{i.name}</Link> : i.name}</td>
                <td>{formatMoney(i.price_cents)}</td>
                <td>{i.image_url ? <span className="badge ok">Yes</span> : <span className="badge warn">Missing</span>}</td>
                <td className="muted">{i.dietary_tags.map((t: string) => DIETARY_LABELS[t as keyof typeof DIETARY_LABELS] ?? t).join(', ')}</td>
                <td>
                  <form action={toggleAvailability.bind(null, id, i.id, !i.is_available)}>
                    <button className={`btn ${i.is_available ? 'secondary' : 'danger'}`} style={{ minHeight: 34 }}>{i.is_available ? 'Available' : 'Sold out'}</button>
                  </form>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ))}
      {canManage(role) ? (
        <div className="card stack">
          <h2 style={{ margin: 0 }}>Add a menu item</h2>
          <ItemForm action={addItem.bind(null, id)} submitLabel="Add item"
            cuisines={CUISINES.map((c) => [c, titleCase(c)])} dietary={DIETARY_TAGS.map((d) => [d, DIETARY_LABELS[d]])} allergens={ALLERGENS.map((a) => [a, ALLERGEN_LABELS[a]])} />
        </div>
      ) : <p className="muted">Staff can mark items sold out. Ask an owner or manager to edit the menu.</p>}
    </div>
  );
}
