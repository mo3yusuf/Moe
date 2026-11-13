import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { Badge, Button, Card, Field, Notice, Screen, SkeletonList, T } from '@/components/ui';
import { api } from '@/lib/api';
import { colors, radius, space } from '@/theme/tokens';

interface Pending {
  id: string; caption: string | null; source: string; isSponsored: boolean; sponsorDisclosure: string | null; createdAt: string;
  durationMs: number | null; previewUrl: string | null; thumbnailUrl?: string | null; processing?: boolean; openReports: number;
  tags: { menuItemName: string; restaurantName: string; status: string }[];
}

/** Admin-only: approve or reject uploaded videos from the phone (same API as the dashboard's Video moderation). */
export default function ReviewVideos() {
  const [items, setItems] = useState<Pending[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems((await api<{ items: Pending[] }>('/v1/admin/videos?status=pending_review')).items);
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load videos'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <Screen padded={false} edges={[]}>
      {error ? <Notice tone="danger" style={{ margin: space.lg }}>{error}</Notice> : null}
      {!items && !error ? <View style={{ paddingHorizontal: space.lg }}><SkeletonList rows={3} /></View> : null}
      {items ? (
        <FlatList
          data={items}
          keyExtractor={(v) => v.id}
          contentContainerStyle={{ gap: space.lg, padding: space.lg }}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.accent} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
          ListHeaderComponent={<T muted>Check: real food, no misleading claims, sponsored posts labelled, no unlicensed music or people filmed without consent.</T>}
          ListEmptyComponent={<T variant="heading" style={{ marginTop: space.lg }}>No videos waiting for review 🎉</T>}
          renderItem={({ item }) => <ReviewCard item={item} onDone={() => setItems((list) => (list ?? []).filter((v) => v.id !== item.id))} />}
        />
      ) : null}
    </Screen>
  );
}

function ReviewCard({ item, onDone }: { item: Pending; onDone(): void }) {
  const player = useVideoPlayer(item.previewUrl && !item.processing ? { uri: item.previewUrl } : null, (p) => { p.loop = true; p.muted = true; });
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'publish' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: 'publish' | 'reject') {
    setBusy(decision); setError(null);
    try {
      await api(`/v1/admin/videos/${item.id}/moderate`, { method: 'POST', body: { decision, notes: decision === 'reject' ? reason.trim() : null } });
      onDone();
    } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong'); }
    finally { setBusy(null); }
  }

  return (
    <Card>
      {item.processing ? (
        <T muted>Still processing — pull down to refresh in a minute.</T>
      ) : item.previewUrl ? (
        <VideoView player={player} style={{ width: '100%', aspectRatio: 9 / 16, height: undefined, borderRadius: radius.md, backgroundColor: '#000' }}
          contentFit="contain" nativeControls playsInline />
      ) : <T muted>File not uploaded yet.</T>}
      <T variant="heading">{item.caption ?? 'No caption'}</T>
      <T variant="small" muted>
        {item.durationMs ? `${Math.round(item.durationMs / 1000)}s · ` : ''}{new Date(item.createdAt).toLocaleString('en-AU')}
      </T>
      {item.isSponsored ? <Badge tone="warning" label={`Sponsored: ${item.sponsorDisclosure ?? ''}`} /> : null}
      {item.openReports ? <Badge tone="danger" label={`${item.openReports} open report(s)`} /> : null}
      {item.tags.map((t) => <T key={t.menuItemName} variant="small" muted>Tag: {t.menuItemName} @ {t.restaurantName} ({t.status})</T>)}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button title={busy === 'publish' ? 'Publishing…' : 'Publish'} onPress={() => decide('publish')} disabled={!!busy || !!item.processing} />
      <View style={{ gap: space.sm }}>
        <Field label="Reason (sent to the uploader if rejected)" value={reason} onChangeText={setReason} maxLength={500} placeholder="e.g. Not food, or copyrighted music" />
        <Button title={busy === 'reject' ? 'Rejecting…' : 'Reject'} variant="danger" onPress={() => decide('reject')} disabled={!!busy || reason.trim().length < 3} />
      </View>
    </Card>
  );
}
