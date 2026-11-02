import { ALLERGEN_LABELS, ALLERGENS, CUISINES, DIETARY_LABELS, DIETARY_TAGS, formatMoney, titleCase, type DietaryTag } from '@crave/core';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';
import { Chip, ChipRow } from '@/components/chips';
import { Button, Card, T } from '@/components/ui';
import { api } from '@/lib/api';
import { config } from '@/lib/config';
import { colors, space } from '@/theme/tokens';

interface Prefs {
  favouriteCuisines: string[]; dislikedCuisines: string[]; dietaryRequirements: DietaryTag[]; avoidAllergens: string[];
  spicePreference: number | null; typicalBudgetCents: number | null; preferredFulfilment: 'pickup' | 'delivery' | null;
}
const EMPTY: Prefs = { favouriteCuisines: [], dislikedCuisines: [], dietaryRequirements: [], avoidAllergens: [], spicePreference: null, typicalBudgetCents: null, preferredFulfilment: null };
const SPICE = ['No chilli', 'Mild', 'Medium', 'Hot', 'Very hot'];
const BUDGETS = [1500, 2000, 3000, 4500];

/** Explicit food preferences. These are the ONLY source of dietary filtering in CRAVE. */
export default function PreferencesScreen() {
  const router = useRouter();
  const [prefs, setPrefs] = useState<Prefs | null>(config.demoMode ? EMPTY : null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (config.demoMode) return;
    api<Prefs>('/v1/preferences').then(setPrefs).catch(() => setPrefs(EMPTY));
  }, []);

  if (!prefs) return <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}><ActivityIndicator color={colors.accent} /></View>;

  const toggle = <K extends 'favouriteCuisines' | 'dislikedCuisines' | 'dietaryRequirements' | 'avoidAllergens'>(key: K, value: string) => {
    setPrefs((p) => {
      if (!p) return p;
      const list = p[key] as string[];
      const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
      const other = key === 'favouriteCuisines' ? 'dislikedCuisines' : key === 'dislikedCuisines' ? 'favouriteCuisines' : null;
      return { ...p, [key]: next, ...(other ? { [other]: (p[other] as string[]).filter((v) => v !== value) } : {}) };
    });
  };

  async function save() {
    if (config.demoMode) return Alert.alert('Demo mode', 'Preferences are saved to your account — not available in demo mode.');
    setSaving(true);
    try {
      await api('/v1/preferences', { method: 'PUT', body: prefs });
      router.back();
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Please try again');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      <Card>
        <T variant="heading">Cuisines you love</T>
        <ChipRow>{CUISINES.map((c) => <Chip key={c} label={titleCase(c)} selected={prefs.favouriteCuisines.includes(c)} onPress={() => toggle('favouriteCuisines', c)} />)}</ChipRow>
      </Card>
      <Card>
        <T variant="heading">Show me less</T>
        <ChipRow>{CUISINES.map((c) => <Chip key={c} tone="danger" label={titleCase(c)} selected={prefs.dislikedCuisines.includes(c)} onPress={() => toggle('dislikedCuisines', c)} />)}</ChipRow>
      </Card>
      <Card>
        <T variant="heading">Dietary requirements</T>
        <T variant="small" muted>Only meals the restaurant has labelled to match will be shown. CRAVE never guesses these from your activity.</T>
        <ChipRow>{DIETARY_TAGS.map((d) => <Chip key={d} label={DIETARY_LABELS[d]} selected={prefs.dietaryRequirements.includes(d)} onPress={() => toggle('dietaryRequirements', d)} />)}</ChipRow>
        <T variant="small" style={{ color: colors.warning }}>Labels are provided by restaurants. If you have an allergy, always confirm with the restaurant before ordering.</T>
      </Card>
      <Card>
        <T variant="heading">Allergens to avoid</T>
        <T variant="small" muted>We hide dishes the restaurant has declared contain these.</T>
        <ChipRow>{ALLERGENS.map((a) => <Chip key={a} tone="danger" label={ALLERGEN_LABELS[a]} selected={prefs.avoidAllergens.includes(a)} onPress={() => toggle('avoidAllergens', a)} />)}</ChipRow>
        <T variant="small" style={{ color: colors.warning }}>A dish without a declaration is not guaranteed allergen-free, and kitchens handle many allergens. If you have a food allergy, always confirm with the restaurant before ordering.</T>
      </Card>
      <Card>
        <T variant="heading">Spice level</T>
        <ChipRow>{SPICE.map((s, i) => <Chip key={s} label={s} selected={prefs.spicePreference === i} onPress={() => setPrefs({ ...prefs, spicePreference: prefs.spicePreference === i ? null : i })} />)}</ChipRow>
      </Card>
      <Card>
        <T variant="heading">Typical spend per meal</T>
        <ChipRow>{BUDGETS.map((b) => <Chip key={b} label={`~${formatMoney(b)}`} selected={prefs.typicalBudgetCents === b} onPress={() => setPrefs({ ...prefs, typicalBudgetCents: prefs.typicalBudgetCents === b ? null : b })} />)}</ChipRow>
      </Card>
      <Button title="Save preferences" onPress={save} loading={saving} />
    </ScrollView>
  );
}
