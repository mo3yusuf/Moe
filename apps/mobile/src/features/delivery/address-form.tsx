import { BRISBANE_SUBURBS, isValidAuPhone } from '@crave/core';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Field, T } from '@/components/ui';
import { colors, space } from '@/theme/tokens';

export interface AddressValue {
  line1: string; line2?: string; suburb: string; region: 'QLD'; postcode: string; lat: number; lng: number;
  contactPhone: string; instructions?: string;
}

/** Australian delivery address. Suburb must be one CRAVE serves; coordinates come from the suburb centre. */
export function AddressForm({ onChange }: { onChange(v: AddressValue | null): void }) {
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const [suburbQuery, setSuburbQuery] = useState('');
  const [suburb, setSuburb] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [instructions, setInstructions] = useState('');

  const matches = useMemo(() => suburbQuery.length < 2 || suburb ? [] :
    Object.keys(BRISBANE_SUBURBS).filter((s) => s.toLowerCase().startsWith(suburbQuery.toLowerCase())).slice(0, 5), [suburbQuery, suburb]);

  const emit = (next: Partial<{ line1: string; line2: string; suburb: string | null; phone: string; instructions: string }>) => {
    const v = { line1, line2, suburb, phone, instructions, ...next };
    const s = v.suburb ? BRISBANE_SUBURBS[v.suburb] : null;
    onChange(s && v.line1.trim().length >= 3 && isValidAuPhone(v.phone)
      ? { line1: v.line1.trim(), line2: v.line2.trim() || undefined, suburb: v.suburb!, region: 'QLD', postcode: s.postcode, lat: s.lat, lng: s.lng,
          contactPhone: v.phone.trim(), instructions: v.instructions.trim() || undefined }
      : null);
  };

  return (
    <View style={{ gap: space.md }}>
      <Field label="Street address" value={line1} autoComplete="street-address" onChangeText={(t) => { setLine1(t); emit({ line1: t }); }} placeholder="12 Merthyr Road" />
      <Field label="Unit / level (optional)" value={line2} onChangeText={(t) => { setLine2(t); emit({ line2: t }); }} />
      <Field label="Suburb" value={suburb ?? suburbQuery} onChangeText={(t) => { setSuburb(null); setSuburbQuery(t); emit({ suburb: null }); }} placeholder="New Farm" />
      {matches.map((m) => (
        <Pressable key={m} accessibilityRole="button" onPress={() => { setSuburb(m); emit({ suburb: m }); }} style={{ paddingVertical: space.xs }}>
          <T>{m} <T muted>QLD {BRISBANE_SUBURBS[m]!.postcode}</T></T>
        </Pressable>
      ))}
      {suburbQuery.length >= 2 && !suburb && !matches.length ? <T variant="small" style={{ color: colors.warning }}>We don’t deliver to that suburb yet.</T> : null}
      <Field label="Mobile for the courier" value={phone} keyboardType="phone-pad" autoComplete="tel" onChangeText={(t) => { setPhone(t); emit({ phone: t }); }} placeholder="0412 345 678" />
      <Field label="Drop-off instructions (optional)" value={instructions} maxLength={200} onChangeText={(t) => { setInstructions(t); emit({ instructions: t }); }} />
      <T variant="small" muted>Your address and phone are shared only with the restaurant and the delivery partner for this order.</T>
    </View>
  );
}
