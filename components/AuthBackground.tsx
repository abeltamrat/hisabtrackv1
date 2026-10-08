import React, { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

export const AUTH_BASE = '#070b1a';
export const AUTH_ACCENT = '#67e8f9';

/** Standalone Aurora backdrop for the public welcome and authentication flows. */
export default function AuthBackground() {
  const id = useId().replace(/:/g, '');
  const lights = [
    { color: '#7c3aed', x: '8%', y: '4%', opacity: 0.62 },
    { color: '#06b6d4', x: '100%', y: '24%', opacity: 0.45 },
    { color: '#f59e0b', x: '0%', y: '66%', opacity: 0.22 },
    { color: '#7c3aed', x: '100%', y: '92%', opacity: 0.32 },
  ];
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: AUTH_BASE }]}>
      <Svg width="100%" height="100%">
        <Defs>
          {lights.map((light, index) => (
            <RadialGradient key={index} id={`${id}-light-${index}`} cx={light.x} cy={light.y} rx="75%" ry="36%">
              <Stop offset="0" stopColor={light.color} stopOpacity={light.opacity} />
              <Stop offset="1" stopColor={light.color} stopOpacity={0} />
            </RadialGradient>
          ))}
        </Defs>
        {lights.map((_, index) => <Rect key={index} width="100%" height="100%" fill={`url(#${id}-light-${index})`} />)}
      </Svg>
    </View>
  );
}
