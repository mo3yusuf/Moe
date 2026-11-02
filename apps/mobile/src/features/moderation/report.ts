
import { Alert } from '@/lib/alert';
import { supabase } from '@/lib/supabase';

const REASONS: [string, string][] = [
  ['misleading', 'Misleading (dish or price doesn’t match)'],
  ['undisclosed_ad', 'Undisclosed advertising'],
  ['food_safety', 'Food safety concern'],
  ['harassment', 'Harassment or hate'],
  ['copyright', 'Copied / stolen content'],
  ['spam', 'Spam'],
  ['other', 'Something else'],
];

/** Lets anyone report a video. Reports go to the admin moderation queue; reporters stay anonymous to uploaders. */
export function reportVideo(videoId: string, uploader?: { id: string; handle: string | null }, onBlocked?: () => void) {
  if (!supabase) return Alert.alert('Demo mode', 'Reporting needs a CRAVE account.');
  Alert.alert('Report this video', 'Why are you reporting it?', [
    ...REASONS.map(([reason, label]) => ({
      text: label,
      onPress: async () => {
        const { data: { user } } = await supabase!.auth.getUser();
        if (!user) return;
        const { error } = await supabase!.from('content_reports').insert({ reporter_id: user.id, target_type: 'video', target_id: videoId, reason });
        Alert.alert(error ? 'Couldn’t send report' : 'Thanks for reporting', error ? error.message : 'Our team will review it. We won’t tell the uploader who reported it.');
      },
    })),
    ...(uploader ? [{
      text: `Block ${uploader.handle ? '@' + uploader.handle : 'this account'}`,
      style: 'destructive' as const,
      onPress: async () => {
        const { data: { user } } = await supabase!.auth.getUser();
        if (!user || user.id === uploader.id) return;
        const { error } = await supabase!.from('user_blocks').insert({ user_id: user.id, blocked_id: uploader.id });
        if (error && error.code !== '23505') return Alert.alert('Couldn’t block', error.message);
        Alert.alert('Blocked', 'You won’t see their videos anymore.');
        onBlocked?.();
      },
    }] : []),
    { text: 'Cancel', style: 'cancel' as const },
  ]);
}
