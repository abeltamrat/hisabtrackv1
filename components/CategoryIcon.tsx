import FontAwesome from '@expo/vector-icons/FontAwesome';
import React from 'react';
import { Text } from 'react-native';

export const EMOJI_ICON_PREFIX = 'emoji:';

export function isEmojiIcon(icon?: string | null) {
  return typeof icon === 'string' && icon.startsWith(EMOJI_ICON_PREFIX);
}

export function extractEmoji(icon?: string | null) {
  if (!icon || !isEmojiIcon(icon)) {
    return '';
  }
  return icon.slice(EMOJI_ICON_PREFIX.length).trim();
}

interface CategoryIconProps {
  icon?: string | null;
  size?: number;
  color?: string;
  fallbackIcon?: React.ComponentProps<typeof FontAwesome>['name'];
}

export default function CategoryIcon({
  icon,
  size = 16,
  color = '#64748b',
  fallbackIcon = 'question',
}: CategoryIconProps) {
  if (isEmojiIcon(icon)) {
    const emoji = extractEmoji(icon);
    if (emoji) {
      return (
        <Text
          style={{
            fontSize: size + 2,
            lineHeight: size + 4,
          }}
        >
          {emoji}
        </Text>
      );
    }
  }

  const iconName = (icon || fallbackIcon) as React.ComponentProps<typeof FontAwesome>['name'];
  return <FontAwesome name={iconName} size={size} color={color} />;
}
