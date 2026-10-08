import { FontAwesome } from '@expo/vector-icons';
import React from 'react';
import { View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { shadeColor } from '@/utils/colorShade';

/**
 * A chunky, glossy 3D-styled squircle around a FontAwesome glyph. Used on
 * Home's quick-action grid (Aurora theme) in place of a flat icon tile —
 * same icon set, same tap targets, just a playful beveled/gloss treatment.
 */
export default function Icon3D({
  icon, size = 54, iconSize, color = '#6366f1', iconColor = '#ffffff',
}: {
  icon: React.ComponentProps<typeof FontAwesome>['name'];
  size?: number;
  iconSize?: number;
  /** Base accent colour; the gradient and bevel are derived from it. */
  color?: string;
  iconColor?: string;
}) {
  const radius = size * 0.32;
  const glyphSize = iconSize ?? Math.round(size * 0.4);
  const light = shadeColor(color, 22);
  const dark = shadeColor(color, -28);
  const gradId = `icon3d-${color.replace('#', '')}`;

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ position: 'absolute' }}>
        <Defs>
          <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={light} />
            <Stop offset="0.55" stopColor={color} />
            <Stop offset="1" stopColor={dark} />
          </LinearGradient>
        </Defs>
        {/* Body */}
        <Rect x={0} y={0} width={size} height={size} rx={radius} fill={`url(#${gradId})`} />
        {/* Top gloss — the darker gradient stop at the base already reads as depth. */}
        <Rect x={size * 0.08} y={size * 0.06} width={size * 0.5} height={size * 0.3} rx={size * 0.15} fill="#ffffff" fillOpacity={0.3} />
      </Svg>
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <FontAwesome name={icon} size={glyphSize} color={iconColor} />
      </View>
    </View>
  );
}
