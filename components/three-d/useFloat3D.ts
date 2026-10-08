import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing } from 'react-native';

/**
 * Drives the gentle bob+tilt shared by every floating 3D object. Returns an
 * Animated.Value driver plus the derived transform; switches to a still
 * frame when the OS "Reduce motion" setting is on (same check CoinLoader
 * already uses).
 */
export function useFloat3D(durationMs = 2200, offsetPx = -10, tiltDeg = 4) {
  const float = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(true);

  useEffect(() => {
    let mounted = true;
    let received = false;
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', value => {
      received = true;
      setReduceMotion(value);
    });
    AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (mounted && !received) setReduceMotion(value);
    }).catch(() => {});
    return () => { mounted = false; sub.remove(); };
  }, []);

  useEffect(() => {
    if (reduceMotion) { float.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(float, { toValue: 1, duration: durationMs, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(float, { toValue: 0, duration: durationMs, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, float, durationMs]);

  const translateY = float.interpolate({ inputRange: [0, 1], outputRange: [0, offsetPx] });
  const rotate = float.interpolate({ inputRange: [0, 1], outputRange: [`-${tiltDeg}deg`, `${tiltDeg}deg`] });

  return { transform: [{ translateY }, { rotate }] };
}

export default useFloat3D;
