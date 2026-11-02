import { useEffect, useState } from 'react';
import { Alert, FlatList, TextInput, View } from 'react-native';
import { Button, Card, Field, T } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/auth';
import { colors, space } from '@/theme/tokens';

interface V {
  id: string; caption: string | null; status: string; moderation_notes: string | null; created_at: string;
  video_stats: { impressions: number; views_3s: number; likes: number; right_swipes: number; shares: number } | null;
  video_menu_items: { status: string; menu_items: { name: string } | null }[];
}
interface Creator { handle: string; affiliate_status: string; is_verified: boolean }

const STATUS: Record<string, string> = { uploading: 'Uploading', processing: 'Processing', pending_review: 'In review', published: 'Live', rejected: 'Not approved', removed: 'Removed' };

export default function MyVideos() {
  const { session } = useAuth();
  const uid = session?.user.id;
  const [videos, setVideos] = useState<V[]>([]);
  const [creator, setCreator] = useState<Creator | null | undefined>(undefined);
  const [handle, setHandle] = useState('');
  const [appeal, setAppeal] = useState<Record<string, string>>({});
  const [appealed, setAppealed] = useState<Set<string>>(new Set());

  async function submitAppeal(videoId: string) {
    if (!supabase || !uid) return;
    const body = (appeal[videoId] ?? '').trim();
    if (body.length < 10) return Alert.alert('Tell us more', 'Explain why the decision should change (at least 10 characters).');
    const { error } = await supabase.from('moderation_appeals').insert({ appellant_id: uid, target_type: 'video', target_id: videoId, body });
    if (error) return Alert.alert('Couldn’t send appeal', error.message);
    setAppealed((s) => new Set(s).add(videoId));
    Alert.alert('Appeal sent', 'A different reviewer will look at it and we’ll notify you of the outcome.');
  }

  async function load() {
    if (!supabase || !uid) return;
    const [v, c] = await Promise.all([
      supabase.from('videos').select('id, caption, status, moderation_notes, created_at, video_stats(impressions, views_3s, likes, right_swipes, shares), video_menu_items(status, menu_items(name))')
        .eq('uploader_id', uid).order('created_at', { ascending: false }),
      supabase.from('creators').select('handle, affiliate_status, is_verified').eq('user_id', uid).maybeSingle(),
    ]);
    setVideos((v.data as unknown as V[]) ?? []);
    setCreator(c.data ?? null);
  }
  useEffect(() => { void load(); }, [uid]);

  async function becomeCreator() {
    if (!supabase || !uid) return;
    const h = handle.trim().toLowerCase();
    if (!/^[a-z0-9_.]{3,30}$/.test(h)) return Alert.alert('Choose a handle', '3–30 characters: letters, numbers, underscores or dots.');
    const { error } = await supabase.from('creators').insert({ user_id: uid, handle: h });
    if (error) return Alert.alert('Could not create profile', error.code === '23505' ? 'That handle is taken.' : error.message);
    void load();
  }

  async function applyAffiliate() {
    if (!supabase || !uid) return;
    const { error } = await supabase.from('creators').update({ affiliate_status: 'applied' }).eq('user_id', uid);
    if (error) return Alert.alert('Could not apply', error.message);
    Alert.alert('Application sent', 'CRAVE will review your profile. Affiliate commissions are not live yet.');
    void load();
  }

  const totals = videos.reduce((a, v) => ({ views: a.views + (v.video_stats?.views_3s ?? 0), craves: a.craves + (v.video_stats?.right_swipes ?? 0), likes: a.likes + (v.video_stats?.likes ?? 0) }), { views: 0, craves: 0, likes: 0 });

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: space.lg, gap: space.md }}
      data={videos}
      keyExtractor={(v) => v.id}
      ListHeaderComponent={
        <View style={{ gap: space.md, marginBottom: space.md }}>
          {creator === null ? (
            <Card>
              <T variant="heading">Create your creator profile</T>
              <T muted>A public handle lets people follow you. Optional — anyone can post.</T>
              <Field label="Handle" value={handle} onChangeText={setHandle} autoCapitalize="none" autoCorrect={false} placeholder="brisbanebites" />
              <Button title="Create profile" variant="secondary" onPress={becomeCreator} />
            </Card>
          ) : creator ? (
            <Card>
              <T variant="heading">@{creator.handle}{creator.is_verified ? ' ✓' : ''}</T>
              <T muted>{totals.views} views (3s+) · {totals.craves} craves · {totals.likes} likes</T>
              <T variant="small" muted>Orders from your videos will appear here once ordering launches.</T>
              {creator.affiliate_status === 'none' || creator.affiliate_status === 'rejected'
                ? <Button title="Apply for affiliate partnerships" variant="secondary" onPress={applyAffiliate} />
                : <T variant="small" muted>Affiliate status: {creator.affiliate_status}</T>}
            </Card>
          ) : null}
        </View>
      }
      ListEmptyComponent={<T muted>You haven’t uploaded any videos yet.</T>}
      renderItem={({ item: v }) => (
        <Card>
          <T variant="heading">{v.caption ?? 'Untitled video'}</T>
          <T style={{ color: v.status === 'published' ? colors.success : v.status === 'rejected' ? colors.danger : colors.warning }}>{STATUS[v.status] ?? v.status}</T>
          {v.moderation_notes && v.status !== 'published' ? <T variant="small" muted>Reviewer: {v.moderation_notes}</T> : null}
          {v.video_menu_items.map((t, i) => <T key={i} variant="small" muted>Tagged {t.menu_items?.name} — {t.status === 'approved' ? 'orderable from your video' : t.status === 'pending' ? 'awaiting restaurant approval' : t.status}</T>)}
          {(v.status === 'rejected' || v.status === 'removed') && !appealed.has(v.id) ? (
            <View style={{ gap: space.sm }}>
              <TextInput value={appeal[v.id] ?? ''} onChangeText={(t) => setAppeal((a) => ({ ...a, [v.id]: t }))} placeholder="Why should this decision be reviewed?"
                placeholderTextColor={colors.textFaint} multiline maxLength={2000} accessibilityLabel="Appeal reason"
                style={{ color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: space.md, minHeight: 60 }} />
              <Button title="Appeal decision" variant="secondary" onPress={() => submitAppeal(v.id)} />
            </View>
          ) : null}
          {v.status === 'published' ? <T variant="small" muted>{v.video_stats?.views_3s ?? 0} views · {v.video_stats?.right_swipes ?? 0} craves · {v.video_stats?.likes ?? 0} likes · {v.video_stats?.shares ?? 0} shares</T> : null}
        </Card>
      )}
    />
  );
}
