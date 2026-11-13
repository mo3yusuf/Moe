import { describe, expect, it } from 'vitest';
import { describeSelection, quoteBasket, unitPriceCents, validateSelection, type ItemDef } from './pricing';

const burger: ItemDef = {
  id: 'burger', name: 'Smash Burger', priceCents: 1500, isAvailable: true, gstApplicable: true,
  optionGroups: [
    { id: 'extras', name: 'Extras', minSelect: 0, maxSelect: 5, options: [
      { id: 'patty', name: 'Extra patty', priceDeltaCents: 400, isAvailable: true, maxQuantity: 3 },
      { id: 'bacon', name: 'Bacon', priceDeltaCents: 300, isAvailable: true },
    ] },
    { id: 'remove', name: 'Remove', minSelect: 0, maxSelect: 4, displayStyle: 'remove', options: [
      { id: 'onion', name: 'Onions', priceDeltaCents: 0, isAvailable: true },
      { id: 'pickle', name: 'Pickles', priceDeltaCents: 0, isAvailable: true },
    ] },
    { id: 'side', name: 'Side', minSelect: 1, maxSelect: 1, options: [
      { id: 'fries', name: 'Fries', priceDeltaCents: 0, isAvailable: true },
      { id: 'salad', name: 'Salad', priceDeltaCents: 0, isAvailable: true },
    ] },
    // Nested: only when Fries is chosen.
    { id: 'fries-sauce', name: 'Fries sauce', minSelect: 1, maxSelect: 1, parentOptionId: 'fries', options: [
      { id: 'aioli', name: 'Aioli', priceDeltaCents: 50, isAvailable: true },
      { id: 'ketchup', name: 'Ketchup', priceDeltaCents: 0, isAvailable: true },
    ] },
  ],
};

describe('option quantities', () => {
  it('allows an option up to its max quantity and prices each one', () => {
    const sel = ['patty', 'patty', 'salad'];
    expect(validateSelection(burger, sel)).toEqual([]);
    expect(unitPriceCents(burger, sel)).toBe(1500 + 2 * 400);
    expect(describeSelection(burger, sel)[0]).toMatchObject({ name: '2× Extra patty', quantity: 2 });
  });
  it('rejects more than the max quantity, and repeats of single options', () => {
    expect(validateSelection(burger, ['patty', 'patty', 'patty', 'patty', 'salad']).map((e) => e.code)).toContain('duplicate_option');
    expect(validateSelection(burger, ['bacon', 'bacon', 'salad']).map((e) => e.code)).toContain('duplicate_option');
  });
  it('counts quantities towards the group maximum', () => {
    const sel = ['patty', 'patty', 'patty', 'bacon', 'salad'];
    expect(validateSelection(burger, sel)).toEqual([]);
    const tooMany = { ...burger, optionGroups: burger.optionGroups.map((g) => (g.id === 'extras' ? { ...g, maxSelect: 3 } : g)) };
    expect(validateSelection(tooMany, sel).map((e) => e.code)).toContain('too_many');
  });
});

describe('nested choices', () => {
  it('requires the nested group only when its parent option is picked', () => {
    expect(validateSelection(burger, ['salad'])).toEqual([]);
    expect(validateSelection(burger, ['fries']).map((e) => e.code)).toEqual(['too_few']);
    expect(validateSelection(burger, ['fries', 'aioli'])).toEqual([]);
    expect(unitPriceCents(burger, ['fries', 'aioli'])).toBe(1550);
  });
  it('rejects a nested option without its parent', () => {
    expect(validateSelection(burger, ['salad', 'aioli']).map((e) => e.code)).toContain('inactive_option');
  });
});

describe('remove-ingredient chips', () => {
  it('describes removals as "No …" for the kitchen, free of charge', () => {
    const sel = ['salad', 'onion', 'pickle'];
    expect(validateSelection(burger, sel)).toEqual([]);
    expect(describeSelection(burger, sel).map((o) => o.name)).toEqual(['No onions', 'No pickles', 'Salad']);
    expect(unitPriceCents(burger, sel)).toBe(1500);
  });
});

describe('combos', () => {
  it('a combo is priced from its base plus the chosen upgrades', () => {
    const combo: ItemDef = {
      id: 'meal', name: 'Burger Meal', priceCents: 1990, isAvailable: true, gstApplicable: true, isCombo: true,
      optionGroups: [
        { id: 'drink', name: 'Drink', minSelect: 1, maxSelect: 1, options: [
          { id: 'coke', name: 'Coke', priceDeltaCents: 0, isAvailable: true, linkedMenuItemId: 'coke-item' },
          { id: 'shake', name: 'Thickshake', priceDeltaCents: 250, isAvailable: false, linkedMenuItemId: 'shake-item' },
        ] },
      ],
    };
    expect(validateSelection(combo, ['coke'])).toEqual([]);
    expect(validateSelection(combo, ['shake']).map((e) => e.code)).toContain('option_unavailable');
    const q = quoteBasket([{ item: combo, optionIds: ['coke'], quantity: 2 }], { commissionRateBps: 1500 });
    expect(q.subtotalCents).toBe(3980);
    expect(q.lines[0]!.options).toEqual([{ id: 'coke', name: 'Coke', priceDeltaCents: 0, quantity: 1 }]);
  });
});
