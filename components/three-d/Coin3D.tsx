import React from 'react';
import { Animated } from 'react-native';
import Svg, { Defs, Ellipse, LinearGradient, Path, Stop } from 'react-native-svg';
import useFloat3D from './useFloat3D';

/**
 * A shaded 3D-looking Birr coin that floats and bobs gently. Purely
 * decorative — it never carries data or state. Switches to a still frame
 * when the OS "Reduce motion" setting is on, same pattern as CoinLoader.
 */
export default function Coin3D({ size = 72, style }: { size?: number; style?: any }) {
  const float = useFloat3D();

  return (
    <Animated.View style={[{ width: size, height: size, transform: float.transform }, style]}>
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
    </Animated.View>
  );
}
