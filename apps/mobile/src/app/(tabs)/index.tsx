import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FeedScreen } from '@/components/feed/FeedScreen';
import { useAuth } from '@/lib/auth';
import { useCoarseLocation } from '@/lib/location';
import { colors } from '@/theme';

type Tab = 'for_you' | 'following';

export default function HomeScreen() {
  const [tab, setTab] = useState<Tab>('for_you');
  const { session } = useAuth();
  const { location } = useCoarseLocation();
  return (
    <View style={styles.root}>
      <FeedScreen
        key={tab}
        kind={tab}
        location={location}
        emptyTitle={tab === 'following' ? (session ? 'Nothing from people you follow yet' : 'Sign in to see who you follow') : 'No videos nearby yet'}
        emptyBody={tab === 'following' ? 'Follow creators and restaurants to fill this feed.' : 'Check back soon — Brisbane restaurants are joining CRAVE.'}
      />
      <SafeAreaView edges={['top']} style={styles.header} pointerEvents="box-none">
        <View style={styles.switcher} accessibilityRole="tablist">
          {(['following', 'for_you'] as const).map((t) => (
            <Pressable key={t} accessibilityRole="tab" accessibilityState={{ selected: tab === t }} onPress={() => setTab(t)} hitSlop={8}>
              <Text style={[styles.tab, tab === t && styles.tabActive]}>{t === 'for_you' ? 'For You' : 'Following'}</Text>
              {tab === t ? <View style={styles.underline} /> : null}
            </Pressable>
          ))}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center' },
  switcher: { flexDirection: 'row', gap: 24, paddingTop: 10 },
  tab: { color: 'rgba(255,255,255,0.65)', fontSize: 17, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4 },
  tabActive: { color: colors.text },
  underline: { height: 3, borderRadius: 2, backgroundColor: colors.accent, marginTop: 4, width: 24, alignSelf: 'center' },
});
