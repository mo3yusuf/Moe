import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router/js-tabs';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';
import { colors } from '@/theme/tokens';

type IconName = ComponentProps<typeof Ionicons>['name'];
const icon = (name: IconName, focusedName: IconName) =>
  ({ color, size, focused }: { color: ColorValue; size: number; focused: boolean }) =>
    <Ionicons name={focused ? focusedName : name} size={size} color={color as string} />;

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.border },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'For You', tabBarIcon: icon('flame-outline', 'flame') }} />
      <Tabs.Screen name="discover" options={{ title: 'Discover', tabBarIcon: icon('compass-outline', 'compass') }} />
      <Tabs.Screen
        name="create"
        options={{
          title: 'Create',
          tabBarIcon: ({ size }) => <Ionicons name="add-circle" size={size + 8} color={colors.accent} />,
          tabBarAccessibilityLabel: 'Create a food video',
        }}
      />
      <Tabs.Screen name="orders" options={{ title: 'Orders', tabBarIcon: icon('receipt-outline', 'receipt') }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('person-outline', 'person') }} />
    </Tabs>
  );
}
