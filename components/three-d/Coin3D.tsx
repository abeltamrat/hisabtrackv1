import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing } from 'react-native';
import Svg, { Defs, Ellipse, LinearGradient, Path, Stop } from 'react-native-svg';

const AnimatedView = Animated.View;

/**
 * A shaded 3D-looking Birr coin that floats and bobs gently. Purely
 * decorative — it never carries data or state. Switches to a still frame
 * when the OS "Reduce motion" setting is on, same pattern as CoinLoader.
 */
export default function Coin3D({ size = 72, style }: { size?: number; style?: any }) {
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
      Animated.timing(float, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(float, { toValue: 0, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, float]);

  const translateY = float.interpolate({ inputRange: [0, 1], outputRange: [0, -10] });
  const rotate = float.interpolate({ inputRange: [0, 1], outputRange: ['-4deg', '4deg'] });

  return (
    <AnimatedView style={[{ width: size, height: size, transform: [{ translateY }, { rotate }] }, style]}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <LinearGradient id="coinFace" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#fde68a" />
            <Stop offset="0.5" stopColor="#f59e0b" />
            <Stop offset="1" stopColor="#b45309" />
          </LinearGradient>
          <LinearGradient id="coinRim" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#fcd34d" />
            <Stop offset="1" stopColor="#92400e" />
          </LinearGradient>
        </Defs>
        {/* Rim / edge depth */}
        <Ellipse cx="50" cy="56" rx="38" ry="38" fill="url(#coinRim)" />
        {/* Face */}
        <Ellipse cx="50" cy="48" rx="38" ry="38" fill="url(#coinFace)" />
        {/* Inner ring */}
        <Ellipse cx="50" cy="48" rx="29" ry="29" fill="none" stroke="#fffbeb" strokeOpacity="0.5" strokeWidth="2" />
        {/* Birr glyph */}
        <Path
          d="M38 32 h16 a10 10 0 0 1 0 20 h-10 v12 m0 -12 h12"
          fill="none" stroke="#fffbeb" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"
        />
        {/* Specular highlight */}
        <Ellipse cx="38" cy="32" rx="12" ry="7" fill="#ffffff" fillOpacity="0.35" />
      </Svg>
    </AnimatedView>
  );
}
