import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Notice } from '@/components/ui/Notice';
import { useAuth } from '@/lib/auth';
import { events } from '@/lib/events';
import { supabase } from '@/lib/supabase';
import { colors, radius, space, type } from '@/theme';

interface CommentRow { id: string; body: string; created_at: string; user_id: string; name: string }

async function loadComments(videoId: string): Promise<CommentRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('comments').select('id, body, created_at, user_id').eq('video_id', videoId).eq('status', 'visible').order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  const ids = [...new Set((data ?? []).map((c) => c.user_id))];
  const { data: profiles } = ids.length ? await supabase.from('profiles').select('id, username, display_name').in('id', ids) : { data: [] };
  const names = new Map((profiles ?? []).map((p: { id: string; username: string | null; display_name: string | null }) => [p.id, p.username ? `@${p.username}` : p.display_name ?? 'CRAVE user']));
  return (data ?? []).map((c) => ({ ...c, name: names.get(c.user_id) ?? 'CRAVE user' }));
}

export default function CommentsScreen() {
  const { videoId } = useLocalSearchParams<{ videoId: string }>();
  const { session } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['comments', videoId], queryFn: () => loadComments(videoId), enabled: !!supabase });

  async function send() {
    if (!supabase || !session || !text.trim()) return;
    setBusy(true);
    const { error } = await supabase.from('comments').insert({ video_id: videoId, user_id: session.user.id, body: text.trim() });
    setBusy(false);
    if (error) return Alert.alert('Comment not posted', error.message);
    events.track('comment', { videoId });
    setText('');
    void qc.invalidateQueries({ queryKey: ['comments', videoId] });
  }

  async function report(c: CommentRow) {
    if (!supabase || !session) return router.push('/sign-in');
    const { error } = await supabase.from('moderation_reports').insert({ target_type: 'comment', target_id: c.id, reason: 'inappropriate' });
    Alert.alert(error ? 'Could not report' : 'Reported', error ? error.message : 'Thanks — our moderators will review this comment.');
  }

  if (!supabase) return <View style={styles.root}><Notice title="Comments need Supabase" body="Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to enable accounts and comments." /></View>;

  return (
    <SafeAreaView edges={['bottom']} style={styles.root}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={80}>
        {isLoading ? <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} /> : (
          <FlatList
            data={data ?? []}
            keyExtractor={(c) => c.id}
            contentContainerStyle={{ padding: space.lg }}
            ListEmptyComponent={<Text style={styles.muted}>No comments yet. Be the first.</Text>}
            renderItem={({ item }) => (
              <View style={styles.comment}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.body}>{item.body}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Report comment" onPress={() => report(item)} hitSlop={8}>
                  <Text style={styles.report}>Report</Text>
                </Pressable>
              </View>
            )}
          />
        )}
        {session ? (
          <View style={styles.inputRow}>
            <TextInput accessibilityLabel="Write a comment" value={text} onChangeText={setText} placeholder="Add a comment…" placeholderTextColor={colors.textDim} maxLength={500} style={styles.input} />
            <Pressable accessibilityRole="button" accessibilityLabel="Post comment" disabled={busy || !text.trim()} onPress={send} style={styles.post}>
              <Text style={{ color: text.trim() ? colors.accent : colors.textDim, fontWeight: '700' }}>Post</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={() => router.push('/sign-in')} style={styles.inputRow}><Text style={styles.muted}>Sign in to comment</Text></Pressable>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, padding: 0 },
  muted: { ...type.body, color: colors.textMuted, textAlign: 'center', marginTop: space.xl },
  comment: { paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  name: { ...type.caption, color: colors.textMuted, fontWeight: '700' },
  body: { ...type.body, color: colors.text, marginTop: 2 },
  report: { ...type.caption, color: colors.textDim, marginTop: 4 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderTopWidth: 1, borderTopColor: colors.border },
  input: { flex: 1, backgroundColor: colors.surface, color: colors.text, borderRadius: radius.pill, paddingHorizontal: 16, minHeight: 44 },
  post: { padding: 8 },
});
