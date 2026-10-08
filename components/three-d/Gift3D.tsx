import React from 'react';
import { Animated } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import useFloat3D from './useFloat3D';

/** A shaded 3D-looking gift box — used for goal-reached celebrations and milestones. */
export default function Gift3D({ size = 72, style }: { size?: number; style?: any }) {
  const float = useFloat3D(2000, -12, 5);

  return (
    <Animated.View style={[{ width: size, height: size, transform: float.transform }, style]}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <LinearGradient id="giftBox" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#fb7185" />
            <Stop offset="1" stopColor="#be123c" />
          </LinearGradient>
          <LinearGradient id="giftLid" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#fda4af" />
            <Stop offset="1" stopColor="#e11d48" />
          </LinearGradient>
        </Defs>
        {/* Box */}
        <Rect x="20" y="46" width="60" height="42" rx="6" fill="url(#giftBox)" />
        {/* Lid */}
        <Rect x="14" y="34" width="72" height="18" rx="6" fill="url(#giftLid)" />
        {/* Ribbon vertical */}
        <Rect x="44" y="34" width="12" height="54" fill="#fde68a" />
        {/* Bow */}
        <Path d="M50 34 C38 24 26 26 30 36 C34 44 46 38 50 34 Z" fill="#fde68a" />
        <Path d="M50 34 C62 24 74 26 70 36 C66 44 54 38 50 34 Z" fill="#fde68a" />
        {/* Specular highlight */}
        <Rect x="24" y="50" width="14" height="30" rx="4" fill="#ffffff" fillOpacity="0.15" />
      </Svg>
    </Animated.View>
  );
}
