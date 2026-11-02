import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router/js-tabs';
import { StyleSheet, View } from 'react-native';
import { colors } from '@/theme';

type IconName = keyof typeof Ionicons.glyphMap;
const icon = (name: IconName, focusedName: IconName) =>
  function TabIcon({ focused, color }: { focused: boolean; color: import("react-native").ColorValue }) {
    return <Ionicons name={focused ? focusedName : name} size={24} color={typeof color === "string" ? color : undefined} />;
  };

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textDim,
        tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.border },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('home-outline', 'home'), tabBarAccessibilityLabel: 'Home feed' }} />
      <Tabs.Screen name="discover" options={{ title: 'Discover', tabBarIcon: icon('compass-outline', 'compass') }} />
      <Tabs.Screen
        name="create"
        options={{
          title: 'Create',
          tabBarAccessibilityLabel: 'Create a food video',
          tabBarIcon: ({ focused }) => (
            <View style={[styles.create, focused && { backgroundColor: colors.accentPressed }]}>
              <Ionicons name="add" size={26} color={colors.text} />
            </View>
          ),
        }}
      />
      <Tabs.Screen name="orders" options={{ title: 'Orders', tabBarIcon: icon('receipt-outline', 'receipt') }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('person-outline', 'person') }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  create: { width: 44, height: 30, borderRadius: 10, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
});
