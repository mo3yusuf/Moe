import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Notice } from '@/components/ui/Notice';
import { Screen, Section } from '@/components/ui/Screen';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { colors, type } from '@/theme';

const CUISINES = ['American', 'Burgers', 'Japanese', 'Sushi', 'Italian', 'Pizza', 'Lebanese', 'Middle Eastern', 'Seafood', 'Australian', 'Taiwanese', 'Asian', 'Thai', 'Indian', 'Mexican', 'Korean', 'Vietnamese', 'Desserts'];
const REQUIREMENTS = [{ key: 'halal_certified', label: 'Halal certified only' }];
const PREFERENCES = [{ key: 'vegetarian', label: 'Vegetarian' }, { key: 'vegan', label: 'Vegan' }, { key: 'gluten_free', label: 'Gluten free' }];
const AVOID = ['peanut', 'tree nut', 'crustacean', 'fish', 'dairy', 'egg', 'gluten', 'sesame', 'soy', 'pork'];
const SPICE = ['No heat', 'Mild', 'Medium', 'Hot', 'Any'];

interface Prefs { favourite_cuisines: string[]; dietary_requirements: string[]; dietary_preferences: string[]; avoid_tags: string[]; max_spice_level: number | null }

const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export default function PreferencesScreen() {
  const { session } = useAuth();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ['prefs', session?.user.id],
    enabled: !!session && !!supabase,
    queryFn: async () => {
      const { data, error } = await supabase!.from('user_preferences').select('favourite_cuisines, dietary_requirements, dietary_preferences, avoid_tags, max_spice_level').eq('user_id', session!.user.id).single();
      if (error) throw error;
      return data as Prefs;
    },
  });
  useEffect(() => {
    if (q.data) setPrefs(q.data);
  }, [q.data]);

  async function save() {
    if (!prefs || !supabase || !session) return;
    setBusy(true);
    const { error } = await supabase.from('user_preferences').update({ ...prefs, onboarding_completed_at: new Date().toISOString() }).eq('user_id', session.user.id);
    setBusy(false);
    Alert.alert(error ? 'Could not save' : 'Saved', error ? error.message : 'Your feed will reflect these preferences.');
  }

  if (!session) return <Screen><Notice title="Sign in to set food preferences" /></Screen>;
  if (!prefs) return <Screen><Text style={{ color: colors.textMuted }}>Loading…</Text></Screen>;

  return (
    <Screen subtitle="Only what you choose here is used as a dietary filter — CRAVE never guesses dietary needs from your activity.">
      <Section title="Favourite cuisines">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {CUISINES.map((c) => <Chip key={c} label={c} selected={prefs.favourite_cuisines.includes(c)} onPress={() => setPrefs({ ...prefs, favourite_cuisines: toggle(prefs.favourite_cuisines, c) })} />)}
        </View>
      </Section>
      <Section title="Requirements (strict filter)">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {REQUIREMENTS.map((r) => <Chip key={r.key} label={r.label} selected={prefs.dietary_requirements.includes(r.key)} onPress={() => setPrefs({ ...prefs, dietary_requirements: toggle(prefs.dietary_requirements, r.key) })} />)}
        </View>
        <Text style={{ ...type.caption, color: colors.textDim }}>Only restaurants whose certification CRAVE has checked are shown.</Text>
      </Section>
      <Section title="Preferences (shown more often)">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {PREFERENCES.map((p) => <Chip key={p.key} label={p.label} selected={prefs.dietary_preferences.includes(p.key)} onPress={() => setPrefs({ ...prefs, dietary_preferences: toggle(prefs.dietary_preferences, p.key) })} />)}
        </View>
      </Section>
      <Section title="Hide meals containing">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {AVOID.map((a) => <Chip key={a} label={a} selected={prefs.avoid_tags.includes(a)} onPress={() => setPrefs({ ...prefs, avoid_tags: toggle(prefs.avoid_tags, a) })} />)}
        </View>
        <Notice title="Allergy safety" body="Hiding relies on ingredient and allergen information supplied by restaurants. CRAVE cannot guarantee a meal is allergen-free — always confirm with the restaurant." />
      </Section>
      <Section title="Maximum spice">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {SPICE.map((label, i) => {
            const value = i === 4 ? null : i;
            return <Chip key={label} label={label} selected={prefs.max_spice_level === value} onPress={() => setPrefs({ ...prefs, max_spice_level: value })} />;
          })}
        </View>
      </Section>
      <Button size="lg" label="Save preferences" onPress={save} loading={busy} />
    </Screen>
  );
}
