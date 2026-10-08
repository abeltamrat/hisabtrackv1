import React from 'react';
import { Animated } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import useFloat3D from './useFloat3D';

/** A shaded 3D-looking shield with a check mark — used for budget/security empty states. */
export default function Shield3D({ size = 72, style }: { size?: number; style?: any }) {
  const float = useFloat3D(2600, -8, 3);

  return (
    <Animated.View style={[{ width: size, height: size, transform: float.transform }, style]}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <LinearGradient id="shieldFace" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#34d399" />
            <Stop offset="1" stopColor="#047857" />
          </LinearGradient>
          <LinearGradient id="shieldEdge" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#6ee7b7" />
            <Stop offset="1" stopColor="#065f46" />
          </LinearGradient>
        </Defs>
        {/* Edge / depth */}
        <Path d="M50 10 L84 24 V52 C84 72 68 86 50 93 C32 86 16 72 16 52 V24 Z" fill="url(#shieldEdge)" transform="translate(0,4)" />
        {/* Face */}
        <Path d="M50 10 L84 24 V52 C84 72 68 86 50 93 C32 86 16 72 16 52 V24 Z" fill="url(#shieldFace)" />
        {/* Check mark */}
        <Path d="M36 50 L46 60 L66 38" fill="none" stroke="#ecfdf5" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
        {/* Specular highlight */}
        <Path d="M30 24 L50 16 L50 30 L34 36 Z" fill="#ffffff" fillOpacity="0.2" />
      </Svg>
    </Animated.View>
  );
}
