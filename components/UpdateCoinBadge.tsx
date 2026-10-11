import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import CoinLoader from './CoinLoader';

/** A tossed Birr coin with a soft glint for new-version notices. */
export default function UpdateCoinBadge() {
  const sparkle = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(true);

  useEffect(() => {
    let mounted = true;
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    AccessibilityInfo.isReduceMotionEnabled()
      .then(value => { if (mounted) setReduceMotion(value); })
      .catch(() => undefined);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    sparkle.setValue(reduceMotion ? 1 : 0);
    if (reduceMotion) return;
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(sparkle, {
        toValue: 1,
        duration: 700,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
        isInteraction: false,
      }),
      Animated.timing(sparkle, {
        toValue: 0,
        duration: 700,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
        isInteraction: false,
      }),
      Animated.delay(500),
    ]));
    animation.start();
    return () => animation.stop();
  }, [reduceMotion, sparkle]);

  const sparkleStyle = {
    opacity: sparkle,
    transform: [{ scale: sparkle.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1.15] }) }],
  };

  return (
    <View style={styles.container}>
      <Animated.Text accessible={false} style={[styles.sparkle, styles.top, sparkleStyle]}>✦</Animated.Text>
      <Animated.Text accessible={false} style={[styles.sparkle, styles.right, sparkleStyle]}>✧</Animated.Text>
      <CoinLoader size={58} accessibilityLabel="New HisabTrack version available" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 86,
    height: 82,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sparkle: {
    position: 'absolute',
    zIndex: 2,
    color: '#fbbf24',
    textShadowColor: 'rgba(251, 191, 36, 0.75)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 7,
  },
  top: {
    top: 0,
    right: 9,
    fontSize: 24,
  },
  right: {
    right: 0,
    bottom: 12,
    fontSize: 18,
  },
});
