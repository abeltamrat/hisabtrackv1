import { LinearGradient as ExpoLinearGradient, type LinearGradientProps } from 'expo-linear-gradient';
import React from 'react';

import { useIsAurora } from '@/contexts/ThemeContext';

/**
 * Drop-in for expo-linear-gradient's LinearGradient. Outside Aurora it is the
 * original component. In Aurora the same gradient renders as tinted glass: each
 * colour keeps its hue at low opacity, so headers and icon tiles become
 * translucent panes over the aurora without any change to the screens.
 */
const GLASS_ALPHA = 0.3;

function toGlass(color: string): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!hex) return color;
  const full = hex[1].length === 3 ? hex[1].split('').map(c => c + c).join('') : hex[1];
  const r = parseInt(full.slice(0, 2), 16), g = parseInt(full.slice(2, 4), 16), b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${GLASS_ALPHA})`;
}

export function LinearGradient(props: LinearGradientProps) {
  const isAurora = useIsAurora();
  if (!isAurora) return <ExpoLinearGradient {...props} />;
  const colors = props.colors.map(color => (typeof color === 'string' ? toGlass(color) : color)) as unknown as LinearGradientProps['colors'];
  return <ExpoLinearGradient {...props} colors={colors} />;
}

export default LinearGradient;
