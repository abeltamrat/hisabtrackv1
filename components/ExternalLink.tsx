import { Link } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import React from 'react';
import { Platform, Text, TouchableOpacity } from 'react-native';

export function ExternalLink(
  props: Omit<React.ComponentProps<typeof Link>, 'href'> & { href: string; children?: React.ReactNode }
) {
  // On native, avoid using Link's web-specific props to prevent DOM type references
  if (Platform.OS !== 'web') {
    return (
      <TouchableOpacity
        onPress={() => WebBrowser.openBrowserAsync(props.href as string)}
        accessibilityRole="link"
      >
        {typeof props.children === 'string' ? (
          <Text>{props.children}</Text>
        ) : (
          props.children as React.ReactElement
        )}
      </TouchableOpacity>
    );
  }

  return (
    <Link
      target="_blank"
      {...props}
      // @ts-expect-error: External URLs are not typed.
      href={props.href}
    />
  );
}
