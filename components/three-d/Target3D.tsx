import React from 'react';
import { Animated } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import useFloat3D from './useFloat3D';

/** A shaded 3D-looking target with an arrow — used for goals empty states. */
export default function Target3D({ size = 72, style }: { size?: number; style?: any }) {
  const float = useFloat3D(2300, -9, 4);

  return (
    <Animated.View style={[{ width: size, height: size, transform: float.transform }, style]}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <LinearGradient id="targetRing" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#f87171" />
            <Stop offset="1" stopColor="#b91c1c" />
          </LinearGradient>
        </Defs>
        <Circle cx="48" cy="52" r="38" fill="url(#targetRing)" />
        <Circle cx="48" cy="52" r="28" fill="#fef2f2" />
        <Circle cx="48" cy="52" r="20" fill="#f87171" />
        <Circle cx="48" cy="52" r="10" fill="#fef2f2" />
        <Circle cx="48" cy="52" r="4" fill="#b91c1c" />
        {/* Arrow */}
        <Path d="M78 18 L50 50" stroke="#78350f" strokeWidth="5" strokeLinecap="round" />
        <Path d="M66 18 L82 14 L78 30 Z" fill="#92400e" />
        {/* Specular highlight */}
        <Circle cx="36" cy="40" r="10" fill="#ffffff" fillOpacity="0.2" />
      </Svg>
    </Animated.View>
  );
}
