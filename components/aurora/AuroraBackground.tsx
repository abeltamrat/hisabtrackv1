import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { AURORA_BASE, AURORA_GLOWS } from './palette';

/**
 * The colour light behind every Aurora screen: a deep navy base with three
 * soft glows. Drawn once, static, with SVG gradients (no blur filters), so it
 * costs nothing while scrolling.
 */
export default function AuroraBackground() {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: AURORA_BASE }]}>
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <RadialGradient id="auroraViolet" cx="8%" cy="4%" rx="75%" ry="38%" fx="8%" fy="4%">
            <Stop offset="0" stopColor={AURORA_GLOWS.violet} stopOpacity="0.62" />
            <Stop offset="1" stopColor={AURORA_GLOWS.violet} stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="auroraCyan" cx="100%" cy="24%" rx="70%" ry="32%" fx="100%" fy="24%">
            <Stop offset="0" stopColor={AURORA_GLOWS.cyan} stopOpacity="0.45" />
            <Stop offset="1" stopColor={AURORA_GLOWS.cyan} stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="auroraAmber" cx="0%" cy="66%" rx="65%" ry="30%" fx="0%" fy="66%">
            <Stop offset="0" stopColor={AURORA_GLOWS.amber} stopOpacity="0.22" />
            <Stop offset="1" stopColor={AURORA_GLOWS.amber} stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="auroraVioletLow" cx="100%" cy="92%" rx="70%" ry="30%" fx="100%" fy="92%">
            <Stop offset="0" stopColor={AURORA_GLOWS.violet} stopOpacity="0.32" />
            <Stop offset="1" stopColor={AURORA_GLOWS.violet} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#auroraViolet)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#auroraCyan)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#auroraAmber)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#auroraVioletLow)" />
      </Svg>
    </View>
  );
}
