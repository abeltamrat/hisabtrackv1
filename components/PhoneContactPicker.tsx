import FormSheet from '@/components/FormSheet';
import DeviceContactsService, { type DeviceContact } from '@/services/DeviceContactsService';
import { normalizeRecipient } from '@/utils/phase2Intelligence';
import { FontAwesome } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Linking, Text, TextInput, TouchableOpacity, View } from 'react-native';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (contact: DeviceContact) => void;
}

export function HisabContactBadge({ verified = true }: { verified?: boolean }) {
  return <View accessibilityLabel={verified ? 'Verified Hisab Track user' : 'Uses Hisab Track (number not verified)'} className="w-11 h-11 mr-3 relative">
    <Image source={require('../assets/images/hisab-coin-icon.png')} className={`w-11 h-11 rounded-full ${verified ? '' : 'opacity-60'}`} resizeMode="cover" />
    {verified && <View className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-600 border-2 border-white dark:border-slate-900 items-center justify-center">
      <FontAwesome name="link" size={8} color="#fff" />
    </View>}
  </View>;
}

export default function PhoneContactPicker({ visible, onClose, onSelect }: Props) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'granted' | 'denied' | 'unavailable'>('idle');
  const [contacts, setContacts] = useState<DeviceContact[]>([]);
  const [query, setQuery] = useState('');
  const [discoveryFailed, setDiscoveryFailed] = useState(false);
  const [discovering, setDiscovering] = useState(false);

  const refreshBadges = async (source: DeviceContact[], forceRefresh = false) => {
    if (!source.length || discovering) return;
    setDiscovering(true);
    setDiscoveryFailed(false);
    try {
      const discovered = await DeviceContactsService.discoverLinkedContacts(source, forceRefresh);
      setContacts(discovered.contacts);
      setDiscoveryFailed(discovered.discoveryFailed);
    } catch {
      setDiscoveryFailed(true);
    } finally {
      setDiscovering(false);
    }
  };

  useEffect(() => {
    if (!visible) return undefined;
    let active = true;
    const load = async () => {
      setLoading(true); setStatus('idle'); setQuery(''); setDiscoveryFailed(false); setDiscovering(false);
      try {
        const result = await DeviceContactsService.requestAndLoadLocal();
        if (!active) return;
        setStatus(result.status); setContacts(result.contacts); setLoading(false);
        if (result.status !== 'granted') return;

        const discovered = await DeviceContactsService.discoverLinkedContacts(result.contacts);
        if (!active) return;
        setContacts(discovered.contacts);
        setDiscoveryFailed(discovered.discoveryFailed);
        setDiscovering(false);
      } catch {
        if (!active) return;
        setStatus('unavailable'); setContacts([]); setLoading(false); setDiscovering(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [visible]);
  const shown = useMemo(() => {
    const needle = normalizeRecipient(query);
    return contacts.filter(contact => !needle || normalizeRecipient(`${contact.name} ${contact.phones.join(' ')} ${contact.emails.join(' ')}`).includes(needle));
  }, [contacts, query]);

  return <FormSheet visible={visible} onClose={onClose} accessibilityLabel="Choose from phone contacts" maxHeight="90%" scrollable={false}>
    <View className="flex-row items-center justify-between mb-4">
      <View className="flex-1 mr-3"><Text className="text-xl font-extrabold text-slate-900 dark:text-white">Phone contacts</Text><Text className="text-xs text-slate-500 dark:text-slate-400 mt-1">Choose a contact to fill the person details.</Text></View>
      <TouchableOpacity accessibilityLabel="Close phone contacts" onPress={onClose} className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 items-center justify-center"><FontAwesome name="close" size={17} color="#94a3b8" /></TouchableOpacity>
    </View>

    {loading ? <View className="items-center py-16"><ActivityIndicator color="#6366f1" /><Text className="text-sm text-slate-500 dark:text-slate-400 mt-3">Opening your contacts…</Text></View> : status === 'denied' ? (
      <View className="items-center py-10"><FontAwesome name="address-book-o" size={38} color="#94a3b8" /><Text className="text-base font-bold text-slate-800 dark:text-white mt-4">Contact access is off</Text><Text className="text-sm text-slate-500 dark:text-slate-400 text-center mt-2">Allow contact access in phone settings, then try again.</Text><TouchableOpacity onPress={() => Linking.openSettings()} className="mt-5 px-5 py-3 rounded-2xl bg-indigo-600"><Text className="text-white font-bold">Open settings</Text></TouchableOpacity></View>
    ) : status === 'unavailable' ? (
      <View className="items-center py-10"><FontAwesome name="address-book-o" size={38} color="#94a3b8" /><Text className="text-base font-bold text-slate-800 dark:text-white mt-4">Contacts are unavailable</Text><Text className="text-sm text-slate-500 dark:text-slate-400 text-center mt-2">You can still enter the person's details manually.</Text></View>
    ) : (
      <>
        <View className="flex-row items-center bg-slate-100 dark:bg-slate-800 rounded-2xl px-4 mb-2"><FontAwesome name="search" size={16} color="#94a3b8" /><TextInput value={query} onChangeText={setQuery} placeholder="Search phone contacts" placeholderTextColor="#94a3b8" className="flex-1 px-3 py-3 text-slate-900 dark:text-white" /></View>
        <View className="flex-row items-center mb-3 px-1"><HisabContactBadge /><Text className="flex-1 text-xs text-slate-500 dark:text-slate-400">The coin and link badge identifies a verified HisabTrack user. A plain coin means the number is saved in someone's HisabTrack profile but not verified. Phone and email values are checked securely and are not stored by discovery.</Text></View>
        {discovering && <View className="flex-row items-center mb-3 px-1"><ActivityIndicator size="small" color="#10b981" /><Text className="text-xs text-slate-500 dark:text-slate-400 ml-2">Checking HisabTrack contacts in the background…</Text></View>}
        {discoveryFailed && <View className="flex-row items-center mb-3 px-1"><Text className="flex-1 text-xs text-amber-600 dark:text-amber-400">HisabTrack badges could not be checked.</Text><TouchableOpacity disabled={discovering} onPress={() => void refreshBadges(contacts, true)} className="px-3 py-2 rounded-xl bg-amber-100 dark:bg-amber-900/30"><Text className="text-xs font-bold text-amber-700 dark:text-amber-300">Retry</Text></TouchableOpacity></View>}
        {!discovering && !discoveryFailed && contacts.length > 0 && !contacts.some(contact => contact.linkedAccount) && <View className="flex-row items-center mb-3 px-1"><Text className="flex-1 text-xs text-slate-500 dark:text-slate-400">No HisabTrack badges found yet.</Text><TouchableOpacity onPress={() => void refreshBadges(contacts, true)} className="px-3 py-2 rounded-xl bg-indigo-100 dark:bg-indigo-900/30"><Text className="text-xs font-bold text-indigo-700 dark:text-indigo-300">Check again</Text></TouchableOpacity></View>}
        <FlatList
          data={shown}
          keyExtractor={contact => contact.id}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          style={{ maxHeight: 384 }}
          initialNumToRender={14}
          maxToRenderPerBatch={18}
          windowSize={7}
          removeClippedSubviews
          renderItem={({ item: contact }) => <TouchableOpacity onPress={() => onSelect(contact)} className="flex-row items-center p-3 mb-2 rounded-2xl border border-slate-200 dark:border-slate-800">
            {contact.linkedAccount ? <HisabContactBadge verified={contact.linkedAccount.verified} /> : <View className="w-11 h-11 rounded-full bg-slate-200 dark:bg-slate-800 items-center justify-center mr-3"><Text className="font-extrabold text-slate-700 dark:text-slate-200">{contact.name.slice(0, 1).toUpperCase()}</Text></View>}
            <View className="flex-1"><View className="flex-row items-center"><Text numberOfLines={1} className="flex-1 font-bold text-slate-900 dark:text-white">{contact.name}</Text>{contact.linkedAccount && <Text className={`text-[10px] font-extrabold ml-2 ${contact.linkedAccount.verified ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}>{contact.linkedAccount.verified ? 'HISABTRACK' : 'ON HISABTRACK'}</Text>}</View><Text numberOfLines={1} className="text-xs text-slate-500 dark:text-slate-400 mt-1">{contact.phone || contact.email}</Text></View>
            <FontAwesome name="chevron-right" size={12} color="#94a3b8" />
          </TouchableOpacity>}
          ListEmptyComponent={<Text className="text-center text-slate-500 dark:text-slate-400 py-10">No matching contacts.</Text>}
        />
      </>
    )}
  </FormSheet>;
}
