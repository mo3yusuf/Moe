import Ionicons from '@expo/vector-icons/Ionicons';
import { DIETARY_LABELS, formatMoney, titleCase, type DietaryTag } from '@crave/core';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, SectionList, View } from 'react-native';
import { Button, LoadingScreen, Notice, T } from '@/components/ui';
import { api } from '@/lib/api';
import { colors, radius, space } from '@/theme/tokens';

interface MenuEntry {
  menuItemId: string; section: string; name: string; description: string | null; priceCents: number; currency: string;
  imageUrl: string | null; dietaryTags: string[]; isAvailable: boolean; videoId: string | null; playbackUrl: string | null;
}
interface Detail {
  restaurant: { id: string; name: string; description: string | null; cuisines: string[]; address: string | null; isOpen: boolean;
    acceptingOrders: boolean; halalCertified: boolean; hours: { dayOfWeek: number; opensAt: string; closesAt: string }[] };
  menu: MenuEntry[];
  following: boolean;
}
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Restaurant page with its "video menu": videos where they exist, photos otherwise. */
export default function RestaurantScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api<Detail>(`/v1/restaurants/${id}`).then(setData).catch((e) => setError(e.message)); }, [id]);

  async function toggleFollow() {
    if (!data) return;
    const follow = !data.following;
    setData({ ...data, following: follow });
    try { await api(`/v1/restaurants/${id}/follow`, { method: 'PUT', body: { follow } }); }
    catch { setData({ ...data, following: !follow }); }
  }

  if (!data) return (error ? <View style={{ flex: 1, backgroundColor: colors.bg, padding: space.lg }}><Notice tone="danger">{error}</Notice></View> : <LoadingScreen />);
  const r = data.restaurant;
  const today = new Date().getDay();
  const todayHours = r.hours.filter((h) => h.dayOfWeek === today).map((h) => `${h.opensAt}–${h.closesAt}`).join(', ') || 'Closed today';
  const sections = Object.entries(data.menu.reduce<Record<string, MenuEntry[]>>((a, m) => ((a[m.section] ??= []).push(m), a), {}))
    .map(([title, items]) => ({ title, data: items }));

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: r.name }} />
      <SectionList
        style={{ backgroundColor: colors.bg }}
        contentContainerStyle={{ padding: space.lg, gap: space.sm }}
        sections={sections}
        keyExtractor={(m) => m.menuItemId}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <View style={{ gap: space.sm, marginBottom: space.lg }}>
            <T muted>{r.cuisines.map(titleCase).join(', ')}{r.halalCertified ? ' · Halal certified' : ''}</T>
            {r.description ? <T>{r.description}</T> : null}
            <T variant="small" muted>{r.address}</T>
            <T variant="small" style={{ color: r.isOpen && r.acceptingOrders ? colors.success : colors.warning }}>
              {r.isOpen ? (r.acceptingOrders ? 'Open now' : 'Not taking orders right now') : 'Closed now'} · Today ({DAYS[today]}) {todayHours}
            </T>
            <Button title={data.following ? 'Following' : 'Follow'} variant={data.following ? 'secondary' : 'primary'} onPress={toggleFollow} />
          </View>
        }
        renderSectionHeader={({ section }) => <T variant="heading" style={{ marginTop: space.md }}>{section.title}</T>}
        renderItem={({ item: m }) => (
          <Pressable accessibilityRole="button" accessibilityLabel={`${m.name}, ${formatMoney(m.priceCents, m.currency)}${m.isAvailable ? '' : ', sold out'}`}
            disabled={!m.isAvailable}
            onPress={() => router.push({ pathname: '/item/[id]', params: { id: m.menuItemId, ...(m.videoId ? { video: m.videoId } : {}) } })}
            style={{ flexDirection: 'row', gap: space.md, paddingVertical: space.sm, opacity: m.isAvailable ? 1 : 0.5 }}>
            <View style={{ width: 84, height: 84, borderRadius: radius.md, backgroundColor: colors.surface, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
              {m.imageUrl ? <Image source={{ uri: m.imageUrl }} style={{ width: 84, height: 84 }} contentFit="cover" accessibilityIgnoresInvertColors /> : <Ionicons name="restaurant-outline" size={28} color={colors.textFaint} />}
              {m.playbackUrl ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Watch video of ${m.name}`} hitSlop={8}
                  onPress={() => router.push({ pathname: '/watch', params: { url: m.playbackUrl!, title: m.name } })}
                  style={{ position: 'absolute', bottom: 4, right: 4, backgroundColor: colors.accent, borderRadius: 999, padding: 6 }}>
                  <Ionicons name="play" size={14} color={colors.text} />
                </Pressable>
              ) : null}
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <T variant="heading">{m.name}</T>
              {m.description ? <T variant="small" muted numberOfLines={2}>{m.description}</T> : null}
              <T>{formatMoney(m.priceCents, m.currency)}{m.isAvailable ? '' : ' · Sold out'}</T>
              {m.dietaryTags.length ? <T variant="small" muted>{m.dietaryTags.map((t) => DIETARY_LABELS[t as DietaryTag] ?? t).join(' · ')}</T> : null}
            </View>
          </Pressable>
        )}
      />
    </>
  );
}
