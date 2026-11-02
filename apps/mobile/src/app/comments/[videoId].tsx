import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, T } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/auth';
import { colors, radius, space } from '@/theme/tokens';

interface Comment { id: string; userId: string; body: string; createdAt: string; name: string }
const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};

/** Comments on a video. Hidden (moderated) comments and blocked accounts are not shown. */
export default function Comments() {
  const { videoId } = useLocalSearchParams<{ videoId: string }>();
  const { session, demoMode } = useAuth();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Comment[] | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const me = session?.user.id;

  const load = useCallback(async () => {
    if (!supabase) { setItems([]); return; }
    const [{ data }, { data: blocks }] = await Promise.all([
      supabase.from('video_comments').select('id, user_id, body, created_at').eq('video_id', videoId).order('created_at', { ascending: false }).limit(100),
      me ? supabase.from('user_blocks').select('blocked_id').eq('user_id', me) : Promise.resolve({ data: [] as { blocked_id: string }[] }),
    ]);
    const blocked = new Set((blocks ?? []).map((b) => b.blocked_id));
    const rows = (data ?? []).filter((r) => !blocked.has(r.user_id));
    const ids = [...new Set(rows.map((r) => r.user_id))];
    const { data: profiles } = ids.length ? await supabase.from('public_profiles').select('id, display_name, username').in('id', ids) : { data: [] };
    const names = new Map((profiles ?? []).map((p: any) => [p.id, p.username ? `@${p.username}` : p.display_name || 'CRAVE user']));
    setItems(rows.map((r) => ({ id: r.id, userId: r.user_id, body: r.body, createdAt: r.created_at, name: names.get(r.user_id) ?? 'Deleted account' })));
  }, [videoId, me]);

  useEffect(() => { void load(); }, [load]);

  async function post() {
    if (!supabase || !me || !text.trim()) return;
    setBusy(true);
    const { error } = await supabase.from('video_comments').insert({ video_id: videoId, user_id: me, body: text.trim().slice(0, 500) });
    setBusy(false);
    if (error) return Alert.alert('Couldn’t post', error.message);
    setText('');
    void load();
  }

  function actions(c: Comment) {
    const own = c.userId === me;
    Alert.alert(c.name, undefined, [
      own
        ? { text: 'Delete comment', style: 'destructive', onPress: async () => { await supabase!.from('video_comments').delete().eq('id', c.id); void load(); } }
        : { text: 'Report comment', onPress: async () => {
            const { error } = await supabase!.from('content_reports').insert({ reporter_id: me, target_type: 'comment', target_id: c.id, reason: 'harassment' });
            Alert.alert(error ? 'Couldn’t report' : 'Reported', error ? error.message : 'Thanks — our team will review it.');
          } },
      ...(!own ? [{ text: 'Block this account', style: 'destructive' as const, onPress: async () => {
        await supabase!.from('user_blocks').insert({ user_id: me, blocked_id: c.userId });
        void load();
      } }] : []),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }

  if (!items) return <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}><ActivityIndicator color={colors.accent} /></View>;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <FlatList
        data={items}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: space.lg, gap: space.lg }}
        ListEmptyComponent={<T muted>{demoMode ? 'Comments need a CRAVE account (demo mode).' : 'No comments yet — be the first.'}</T>}
        renderItem={({ item: c }) => (
          <Pressable onLongPress={() => actions(c)} accessibilityHint="Long press for options" accessibilityActions={[{ name: 'longpress', label: 'Options' }]}
            onAccessibilityAction={() => actions(c)} style={{ gap: 2 }}>
            <T variant="small" muted>{c.name} · {ago(c.createdAt)}</T>
            <T>{c.body}</T>
          </Pressable>
        )}
      />
      {!demoMode ? (
        <View style={{ flexDirection: 'row', gap: space.sm, padding: space.md, paddingBottom: space.md + insets.bottom, borderTopWidth: 1, borderTopColor: colors.border }}>
          <TextInput value={text} onChangeText={setText} placeholder="Add a comment…" placeholderTextColor={colors.textFaint} maxLength={500} multiline
            accessibilityLabel="Add a comment"
            style={{ flex: 1, color: colors.text, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm, maxHeight: 100 }} />
          <Button title="Post" onPress={post} loading={busy} disabled={!text.trim()} />
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}
