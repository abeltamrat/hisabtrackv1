import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicatorProps, Animated, AppState, Easing, StyleSheet, View } from 'react-native';

/** Shared loading indicator: a tossed Birr coin, with a still reduced-motion mode. */
export default function CoinLoader({
  size = 'small', animating = true, hidesWhenStopped = true,
  color: _color, style, accessibilityLabel = 'Loading', ...props
}: ActivityIndicatorProps) {
  const progress = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(true);
  const [active, setActive] = useState(AppState.currentState === 'active');
  const diameter = typeof size === 'number' ? Math.max(1, size) : size === 'large' ? 56 : 24;

  useEffect(() => {
    let mounted = true;
    let motionEventReceived = false;
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', value => {
      motionEventReceived = true;
      setReduceMotion(value);
    });
    AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (mounted && !motionEventReceived) setReduceMotion(value);
    }).catch(() => { /* Keep a still coin when the preference is unavailable. */ });
    const state = AppState.addEventListener('change', value => setActive(value === 'active'));
    return () => { mounted = false; motion.remove(); state.remove(); };
  }, []);

  useEffect(() => {
    progress.setValue(0);
    if (!animating || reduceMotion || !active) return;
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(progress, {
        toValue: 1, duration: 1100, easing: Easing.linear,
        useNativeDriver: true, isInteraction: false,
      }),
      Animated.delay(180),
    ]));
    animation.start();
    return () => { animation.stop(); progress.setValue(0); };
  }, [active, animating, progress, reduceMotion]);

  if (!animating && hidesWhenStopped) return null;
  const translateY = progress.interpolate({
    inputRange: [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1],
    outputRange: [0, -0.105, -0.18, -0.225, -0.24, -0.225, -0.18, -0.105, 0].map(value => value * diameter),
  });
  // Keep both sides readable using a narrow edge-on silhouette between flips.
  const scaleX = progress.interpolate({
    inputRange: [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1],
    outputRange: [1, 0.08, 1, 0.08, 1, 0.08, 1, 0.08, 1],
  });
  return (
    <View
      accessible accessibilityRole="progressbar" accessibilityLabel={accessibilityLabel}
      accessibilityState={{ busy: animating }}
      {...props}
      style={[styles.container, { width: diameter, height: diameter * 1.4 }, style]}
    >
      <Animated.Image
        accessible={false}
        source={require('../assets/images/hisab-coin-loader.png')}
        resizeMode="contain"
        style={{ width: diameter, height: diameter, transform: [{ translateY }, { scaleX }] }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'flex-end' },
});
