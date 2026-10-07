import type { RootState } from '@/store';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { useSelector } from 'react-redux';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useLedgerClock } from '@/hooks/useLedgerClock';
import SyncService from '@/services/SyncService';

const APP_HEADER_HEIGHT = 56;

export default function DataStatusBanner() {
  useLedgerClock();
  const progress = useRef(new Animated.Value(0)).current;
  const { width } = useWindowDimensions();
  const { user } = useAuth();
  const { actualTheme } = useTheme();
  const error = useSelector((state: RootState) =>
    state.accounts.error || state.transactions.error || state.budgets.error || state.loans.error,
  );
  const loading = useSelector((state: RootState) =>
    state.accounts.loading || state.transactions.loading || state.budgets.loading || state.loans.loading,
  );
  const message = error || SyncService.lastError;

  useEffect(() => {
    if (!loading || message) {
      progress.stopAnimation();
      progress.setValue(0);
      return;
    }

    const animation = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 1100,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [loading, message, progress]);

  if (!message && !loading) return null;

  if (loading && !message) {
    const indicatorWidth = Math.max(96, width * 0.34);

    return (
      <View
        pointerEvents="none"
        accessibilityRole="progressbar"
        accessibilityLabel="Refreshing device data"
        accessibilityLiveRegion="polite"
        style={{
          position: 'absolute',
          top: APP_HEADER_HEIGHT - 3,
          left: 0,
          right: 0,
          height: 3,
          overflow: 'hidden',
          zIndex: 2001,
          elevation: 5,
          backgroundColor: actualTheme === 'dark' ? '#1e293b' : '#e2e8f0',
        }}
      >
        <Animated.View
          style={{
            width: indicatorWidth,
            height: '100%',
            borderRadius: 999,
            backgroundColor: actualTheme === 'dark' ? '#818cf8' : '#4f46e5',
            transform: [{
              translateX: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [-indicatorWidth, width],
              }),
            }],
          }}
        />
      </View>
    );
  }

  const isDark = actualTheme === 'dark';
  const palette = {
    background: isDark ? '#422006' : '#fef3c7',
    text: isDark ? '#fde68a' : '#78350f',
    action: isDark ? '#93c5fd' : '#0369a1',
  };

  return (
    <View accessibilityLiveRegion="polite" style={{ padding: 8, backgroundColor: palette.background }}>
      <Text style={{ color: palette.text }}>{`Data needs attention: ${message}`}</Text>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Retry loading data"
        onPress={() => { void SyncService.syncNow(user?.uid).catch(() => undefined); }}
      >
        <Text style={{ color: palette.action, paddingTop: 4 }}>Retry</Text>
      </TouchableOpacity>
    </View>
  );
}
