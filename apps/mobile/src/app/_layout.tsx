import { DarkTheme, Stack, ThemeProvider, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StripeProvider } from '@/lib/stripe';
import { config, loadRuntimeConfig } from '@/lib/config';
import { capturePendingMatch } from '@/lib/pending-match';
import { initSentry, reportError } from '@/lib/sentry';
import { prefetchFeed } from '@/features/feed/use-feed';
import { AuthProvider, useAuth } from '@/providers/auth';
import { colors } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync();
capturePendingMatch();
initSentry();
void loadRuntimeConfig(); // is ordering switched on? (background; never delays start-up)

const navTheme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.bg, primary: colors.accent, text: colors.text, border: colors.border },
};

function RootNavigator() {
  const { session, isLoading, demoMode } = useAuth();
  useEffect(() => { if (!isLoading) SplashScreen.hideAsync(); }, [isLoading]);
  // Signed in: start fetching the first feed page now, while the screens are still being drawn.
  useEffect(() => { if (session) prefetchFeed(); }, [session]);
  if (isLoading) return null;
  const signedIn = demoMode || !!session;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="preferences" options={{ headerShown: true, title: 'Food preferences' }} />
        <Stack.Screen name="taste-profile" options={{ headerShown: true, title: 'Your taste profile' }} />
        <Stack.Screen name="my-videos" options={{ headerShown: true, title: 'My videos' }} />
        <Stack.Screen name="review-videos" options={{ headerShown: true, title: 'Review videos' }} />
        <Stack.Screen name="restaurant/[id]" options={{ headerShown: true, title: '' }} />
        <Stack.Screen name="watch" options={{ headerShown: true, presentation: 'modal' }} />
        <Stack.Screen name="item/[id]" options={{ headerShown: true, title: '', presentation: 'modal' }} />
        <Stack.Screen name="basket" options={{ headerShown: true, title: 'Your basket' }} />
        <Stack.Screen name="pay/[id]" options={{ headerShown: true, title: 'Payment', gestureEnabled: false }} />
        <Stack.Screen name="order/[id]" options={{ headerShown: true, title: 'Order' }} />
        <Stack.Screen name="comments/[videoId]" options={{ headerShown: true, title: 'Comments', presentation: 'modal' }} />
        <Stack.Screen name="cravings" options={{ headerShown: true, title: 'Your Cravings' }} />
        <Stack.Screen name="reset-password" options={{ headerShown: true, title: 'New password' }} />
        <Stack.Screen name="match/index" options={{ headerShown: true, title: 'Crave Match', presentation: 'modal' }} />
        <Stack.Screen name="match/[code]" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="privacy" options={{ headerShown: true, title: 'Privacy & personalisation', presentation: 'modal' }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}

// A screen crashed: report it (Sentry) and offer a way back instead of a blank page.
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => { reportError(error); }, [error]);
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 }}>
      <Text style={{ color: colors.text, fontSize: 20, fontWeight: '700' }}>Something went wrong</Text>
      <Text style={{ color: colors.textMuted, textAlign: 'center' }}>We've been notified. Try again in a moment.</Text>
      <Pressable onPress={retry} accessibilityRole="button" style={{ marginTop: 8, backgroundColor: colors.accent, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 999 }}>
        <Text style={{ color: '#fff', fontWeight: '700' }}>Try again</Text>
      </Pressable>
    </View>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <ThemeProvider value={navTheme}>
          <StripeProvider publishableKey={config.stripePublishableKey} merchantIdentifier="merchant.app.crave.mobile" urlScheme="crave">
            <AuthProvider>
              <StatusBar style="light" />
              <RootNavigator />
            </AuthProvider>
          </StripeProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
