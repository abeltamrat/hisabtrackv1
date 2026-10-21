import LocalChangeEmitter from '@/services/LocalChangeEmitter';
import RecipientIdentityService from '@/services/RecipientIdentityService';
import { FontAwesome } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
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

// Several mounted screens use the linked set; they share one People load per
// change instead of each reading People on every local write.
let sharedLinkedIds = new Set<string>();
const linkedIdListeners = new Set<(ids: Set<string>) => void>();
let unsubscribeLinkedIds: (() => void) | null = null;

const sameIds = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every(id => b.has(id));

async function loadLinkedPersonIds() {
  const people = await RecipientIdentityService.getAll();
  const next = new Set(people.filter(person => !!person.linkedUid && !person.archivedAt).map(person => person.id));
  if (sameIds(next, sharedLinkedIds)) return;
  sharedLinkedIds = next;
  linkedIdListeners.forEach(listener => listener(next));
}

/** Keeps record-only screens in sync with linked status stored on People. */
export function useLinkedPersonIds() {
  const [linkedIds, setLinkedIds] = useState<Set<string>>(sharedLinkedIds);
  useEffect(() => {
    linkedIdListeners.add(setLinkedIds);
    if (!unsubscribeLinkedIds) {
      unsubscribeLinkedIds = LocalChangeEmitter.subscribe(() => loadLinkedPersonIds().catch(() => undefined));
    }
    // Refresh on mount too, so a new screen (or a new signed-in user) never shows a stale set.
    setLinkedIds(sharedLinkedIds);
    void loadLinkedPersonIds().catch(() => undefined);
    return () => {
      linkedIdListeners.delete(setLinkedIds);
      if (!linkedIdListeners.size && unsubscribeLinkedIds) { unsubscribeLinkedIds(); unsubscribeLinkedIds = null; }
    };
  }, []);
  return linkedIds;
}
