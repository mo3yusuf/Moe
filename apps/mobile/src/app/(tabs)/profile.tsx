import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Screen, Section } from '@/components/ui/Screen';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { colors, radius, space, type } from '@/theme';

interface SavedRow { id: string; source: string; video_id: string | null; menu_item_id: string | null; menu_items: { name: string; price_cents: number } | null }

function LinkRow({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.link}>
      <Ionicons name={icon} size={20} color={colors.text} />
      <Text style={styles.linkText}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
    </Pressable>
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const { session, profile, roles, signOut } = useAuth();
  const cravings = useQuery({
    queryKey: ['cravings', session?.user.id],
    enabled: !!session && !!supabase,
    queryFn: async () => {
      const { data, error } = await supabase!.from('saved_meals').select('id, source, video_id, menu_item_id, menu_items(name, price_cents)').order('created_at', { ascending: false }).limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as SavedRow[];
    },
  });

  if (!session) {
    return (
      <Screen title="Profile" subtitle="Save your Cravings, follow creators and order in seconds.">
        <Button size="lg" label="Sign in or create account" onPress={() => router.push('/sign-in')} />
        <View style={{ height: space.xl }} />
        <LinkRow icon="shield-checkmark-outline" label="Privacy & personalisation" onPress={() => router.push('/settings/privacy')} />
      </Screen>
    );
  }

  return (
    <Screen title={profile?.display_name ?? 'Your profile'} subtitle={profile?.username ? `@${profile.username}` : undefined}>
      <View style={styles.stats}>
        <Stat label="Followers" value={profile?.follower_count ?? 0} />
        <Stat label="Following" value={profile?.following_count ?? 0} />
        <Stat label="Cravings" value={cravings.data?.length ?? 0} />
      </View>
      {roles.length > 1 ? <Text style={styles.roles}>Roles: {roles.join(', ')}</Text> : null}

      <Section title="Cravings">
        {cravings.data?.length ? cravings.data.map((c) => (
          <Pressable key={c.id} accessibilityRole="button" onPress={() => c.menu_item_id && router.push({ pathname: '/meal/[id]', params: { id: c.menu_item_id } })} style={styles.craving}>
            <Ionicons name={c.source === 'crave_swipe' ? 'flame' : 'bookmark'} size={18} color={colors.accent} />
            <Text style={styles.cravingText} numberOfLines={1}>{c.menu_items?.name ?? 'Saved video'}</Text>
            {c.menu_items ? <Text style={styles.cravingPrice}>{new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(c.menu_items.price_cents / 100)}</Text> : null}
          </Pressable>
        )) : <Text style={styles.muted}>Swipe right on a video to save it here.</Text>}
      </Section>

      <Section title="Settings">
        <LinkRow icon="restaurant-outline" label="Food preferences" onPress={() => router.push('/settings/preferences')} />
        <LinkRow icon="shield-checkmark-outline" label="Privacy & personalisation" onPress={() => router.push('/settings/privacy')} />
      </Section>
      <Button variant="secondary" label="Sign out" onPress={() => void signOut()} />
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${value} ${label}`}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, marginBottom: space.xl, borderWidth: 1, borderColor: colors.border },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { ...type.title, color: colors.text },
  statLabel: { ...type.caption, color: colors.textMuted },
  roles: { ...type.caption, color: colors.textMuted, marginTop: -space.md, marginBottom: space.lg },
  craving: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  cravingText: { ...type.bodyStrong, color: colors.text, flex: 1 },
  cravingPrice: { ...type.bodyStrong, color: colors.textMuted },
  muted: { ...type.body, color: colors.textMuted },
  link: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  linkText: { ...type.bodyStrong, color: colors.text, flex: 1 },
});
