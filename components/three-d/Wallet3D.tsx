import React from 'react';
import { Animated } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import useFloat3D from './useFloat3D';

/** A shaded 3D-looking wallet with a peeking note. Decorative only. */
export default function Wallet3D({ size = 72, style }: { size?: number; style?: any }) {
  const float = useFloat3D(2400, -9, 3);

  return (
    <Animated.View style={[{ width: size, height: size, transform: float.transform }, style]}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <LinearGradient id="walletBody" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#4f46e5" />
            <Stop offset="1" stopColor="#312e81" />
          </LinearGradient>
          <LinearGradient id="walletFlap" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#6366f1" />
            <Stop offset="1" stopColor="#4338ca" />
          </LinearGradient>
          <LinearGradient id="walletNote" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#6ee7b7" />
            <Stop offset="1" stopColor="#10b981" />
          </LinearGradient>
        </Defs>
        {/* Peeking note */}
        <Rect x="30" y="20" width="44" height="26" rx="3" fill="url(#walletNote)" transform="rotate(-8 52 33)" />
        {/* Body */}
        <Rect x="14" y="38" width="72" height="46" rx="10" fill="url(#walletBody)" />
        {/* Flap */}
        <Path d="M14 48 a10 10 0 0 1 10 -10 h52 a10 10 0 0 1 10 10 v6 h-72 z" fill="url(#walletFlap)" />
        {/* Clasp */}
        <Rect x="66" y="56" width="16" height="14" rx="4" fill="#fbbf24" />
        <Rect x="70" y="60" width="8" height="6" rx="2" fill="#92400e" />
        {/* Stitch highlight */}
        <Path d="M20 60 h60" stroke="#ffffff" strokeOpacity="0.15" strokeWidth="2" strokeDasharray="2 4" />
      </Svg>
    </Animated.View>
  );
}
