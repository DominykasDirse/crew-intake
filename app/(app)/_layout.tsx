import { Stack } from 'expo-router';

import { colors } from '@/theme';

export default function AppLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="report/[date]/index" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="report/[date]/review" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="report/[date]/sent" options={{ animation: 'fade' }} />
    </Stack>
  );
}
