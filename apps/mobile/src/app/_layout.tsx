import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '@/providers/auth';
import { colors } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync();

const navTheme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.bg, primary: colors.accent, text: colors.text, border: colors.border },
};

function RootNavigator() {
  const { session, isLoading, demoMode } = useAuth();
  useEffect(() => { if (!isLoading) SplashScreen.hideAsync(); }, [isLoading]);
  if (isLoading) return null;
  const signedIn = demoMode || !!session;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="preferences" options={{ headerShown: true, title: 'Food preferences' }} />
        <Stack.Screen name="taste-profile" options={{ headerShown: true, title: 'Your taste profile' }} />
        <Stack.Screen name="my-videos" options={{ headerShown: true, title: 'My videos' }} />
        <Stack.Screen name="restaurant/[id]" options={{ headerShown: true, title: '' }} />
        <Stack.Screen name="watch" options={{ headerShown: true, presentation: 'modal' }} />
        <Stack.Screen name="cravings" options={{ headerShown: true, title: 'Your Cravings' }} />
        <Stack.Screen name="privacy" options={{ headerShown: true, title: 'Privacy & personalisation', presentation: 'modal' }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <ThemeProvider value={navTheme}>
          <AuthProvider>
            <StatusBar style="light" />
            <RootNavigator />
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
