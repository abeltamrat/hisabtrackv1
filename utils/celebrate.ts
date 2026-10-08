import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

/**
 * A small moment of delight for a genuine win (a transaction saved, a goal
 * reached) — just a success haptic for now. Guarded the same way
 * app/calculator.tsx guards its haptics, since expo-haptics has no web
 * implementation. Never throws, so it's safe to call from any success path.
 */
export function celebrate() {
  if (Platform.OS === 'web') return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}
