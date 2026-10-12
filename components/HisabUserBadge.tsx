import LocalChangeEmitter from '@/services/LocalChangeEmitter';
import RecipientIdentityService from '@/services/RecipientIdentityService';
import { FontAwesome } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import { Image, View } from 'react-native';

export default function HisabUserBadge({ linked = true, size = 19 }: { linked?: boolean; size?: number }) {
  if (!linked) return null;
  const linkSize = Math.max(8, Math.round(size * 0.48));
  return (
    <View accessible accessibilityRole="image" accessibilityLabel="HisabTrack user" className="relative ml-1.5" style={{ width: size, height: size }}>
      <Image source={require('../assets/images/hisab-coin-icon.png')} resizeMode="cover" style={{ width: size, height: size, borderRadius: size / 2 }} />
      <View className="absolute -bottom-0.5 -right-0.5 rounded-full bg-emerald-600 border border-white dark:border-slate-900 items-center justify-center" style={{ width: linkSize, height: linkSize }}>
        <FontAwesome name="link" size={Math.max(5, Math.round(linkSize * 0.5))} color="#fff" />
      </View>
    </View>
  );
}

/** Keeps record-only screens in sync with linked status stored on People. */
export function useLinkedPersonIds() {
  const [linkedIds, setLinkedIds] = useState<Set<string>>(new Set());
  const load = useCallback(async () => {
    const people = await RecipientIdentityService.getAll();
    setLinkedIds(new Set(people.filter(person => !!person.linkedUid && !person.archivedAt).map(person => person.id)));
  }, []);
  useEffect(() => {
    void load();
    const unsubscribe = LocalChangeEmitter.subscribe(() => { void load(); });
    return () => { unsubscribe(); };
  }, [load]);
  return linkedIds;
}
