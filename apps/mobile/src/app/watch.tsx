import { Stack, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { View } from 'react-native';
import { colors } from '@/theme/tokens';

/** Full-screen player for a single video (e.g. from a restaurant's video menu). */
export default function Watch() {
  const { url, title } = useLocalSearchParams<{ url: string; title?: string }>();
  const allowed = typeof url === 'string' && url.startsWith('https://');
  const player = useVideoPlayer(allowed ? { uri: url, useCaching: true } : null, (p) => { p.loop = true; p.play(); });
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ headerShown: true, title: title ?? 'Video', presentation: 'modal' }} />
      <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls />
    </View>
  );
}
