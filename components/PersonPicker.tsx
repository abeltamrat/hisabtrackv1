import { FontAwesome } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Alert } from '@/utils/alert';
import FormSheet from '@/components/FormSheet';
import PhoneContactPicker from '@/components/PhoneContactPicker';
import type { DeviceContact, LinkedContactMatch } from '@/services/DeviceContactsService';
import RecipientIdentityService, { DEFAULT_PERSON_GROUPS, normalizePersonEmail, normalizePersonPhone, type RecipientProfile } from '@/services/RecipientIdentityService';
import { normalizeRecipient } from '@/utils/phase2Intelligence';

interface Props {
  visible: boolean;
  selectedId?: string;
  suggestedName?: string;
  onClose: () => void;
  onSelect: (person?: RecipientProfile) => void;
}

export default function PersonPicker({ visible, selectedId, suggestedName, onClose, onSelect }: Props) {
  const [people, setPeople] = useState<RecipientProfile[]>([]);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [groups, setGroups] = useState<string[]>([]);
  const [customGroup, setCustomGroup] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [contactsOpen, setContactsOpen] = useState(false);
  const [importedLinkedAccount, setImportedLinkedAccount] = useState<LinkedContactMatch>();

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    setCreating(false);
    setName(suggestedName?.trim() || '');
    setGroups([]);
    setCustomGroup('');
    setPhone('');
    setEmail('');
    setContactsOpen(false);
    setImportedLinkedAccount(undefined);
    RecipientIdentityService.getAll().then(setPeople);
  }, [suggestedName, visible]);

  const shown = useMemo(() => {
    const needle = normalizeRecipient(query);
    return people
      .filter(person => !person.archivedAt)
      .filter(person => !needle || normalizeRecipient(`${person.displayName} ${person.phone || ''} ${person.email || ''} ${person.aliases.join(' ')} ${(person.groups || []).join(' ')}`).includes(needle))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [people, query]);

  const createPerson = async () => {
    if (!name.trim()) return Alert.alert('Name required', 'Enter the person or organization name.');
    if (!phone.trim() && !email.trim()) return Alert.alert('Contact required', 'Enter a phone number or email address to identify this person.');
    setSaving(true);
    try {
      let person = await RecipientIdentityService.create({ displayName: name, phone, email, groups: [...groups, ...(customGroup.trim() ? [customGroup.trim()] : [])], linkedUid: importedLinkedAccount?.uid, linkedDisplayName: importedLinkedAccount?.displayName, linkCheckedAt: importedLinkedAccount ? Date.now() : undefined });
      try { person = await RecipientIdentityService.refreshLinkedAccount(person.id); } catch { /* An offline or unregistered contact remains a valid local person. */ }
      setPeople(current => [...current, person]);
      onSelect(person);
      onClose();
    } catch (error: any) {
      Alert.alert('Could not save person', error?.message || 'Try again.');
    } finally { setSaving(false); }
  };

  const chooseContact = (contact: DeviceContact) => {
    const contactPhone = normalizePersonPhone(contact.phone);
    const contactEmail = normalizePersonEmail(contact.email);
    const existing = people.find(person => (contactPhone && person.phone === contactPhone) || (contactEmail && person.email === contactEmail));
    setContactsOpen(false);
    if (existing) {
      onSelect(existing);
      onClose();
      return;
    }
    setName(contact.name);
    setPhone(contact.phone || '');
    setEmail(contact.email || '');
    // An unverified (saved-number) match is shown as a hint only; it never links accounts.
    setImportedLinkedAccount(contact.linkedAccount?.verified ? contact.linkedAccount : undefined);
    setCreating(true);
  };

  return <>
    <FormSheet visible={visible && !contactsOpen} onClose={onClose} accessibilityLabel="Choose a person" maxHeight="88%" scrollable={false}>
          <View className="flex-row items-center justify-between mb-4">
            <View>
              <Text className="text-xl font-extrabold text-slate-900 dark:text-white">Choose a person</Text>
              <Text className="text-xs text-slate-500 dark:text-slate-400 mt-1">Link this transaction for accurate history and reports.</Text>
            </View>
            <TouchableOpacity accessibilityLabel="Close people picker" onPress={onClose} className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 items-center justify-center">
              <FontAwesome name="close" size={17} color="#94a3b8" />
            </TouchableOpacity>
          </View>

          {creating ? (
            <View>
              <TouchableOpacity onPress={() => setContactsOpen(true)} className="flex-row items-center p-3 rounded-2xl bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-900 mb-4"><View className="w-10 h-10 rounded-full bg-teal-600 items-center justify-center mr-3"><FontAwesome name="address-book" size={15} color="#fff" /></View><View className="flex-1"><Text className="font-bold text-teal-800 dark:text-teal-200">Choose from phone contacts</Text><Text className="text-xs text-teal-600 dark:text-teal-400 mt-0.5">Fill the name, phone and email automatically</Text></View><FontAwesome name="chevron-right" size={12} color="#0d9488" /></TouchableOpacity>
              <Text className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-2">Name</Text>
              <TextInput value={name} onChangeText={value => { setName(value); setImportedLinkedAccount(undefined); }} autoFocus placeholder="Person or organization" placeholderTextColor="#94a3b8" className="bg-slate-100 dark:bg-slate-800 rounded-2xl px-4 py-3 text-slate-900 dark:text-white" />
              <Text className="text-xs font-bold text-slate-700 dark:text-slate-200 mt-4 mb-2">Phone or email</Text>
              <TextInput value={phone} onChangeText={value => { setPhone(value); setImportedLinkedAccount(undefined); }} placeholder="Phone, e.g. 0912345678" placeholderTextColor="#94a3b8" keyboardType="phone-pad" className="bg-slate-100 dark:bg-slate-800 rounded-2xl px-4 py-3 text-slate-900 dark:text-white" />
              <TextInput value={email} onChangeText={value => { setEmail(value); setImportedLinkedAccount(undefined); }} placeholder="Email address" placeholderTextColor="#94a3b8" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} className="bg-slate-100 dark:bg-slate-800 rounded-2xl px-4 py-3 mt-3 text-slate-900 dark:text-white" />
              <Text className="text-[10px] text-slate-500 dark:text-slate-400 mt-2">At least one is required. It prevents duplicates and can link a registered Hisab Track user.</Text>
              <Text className="text-xs font-bold text-slate-700 dark:text-slate-200 mt-4 mb-2">Groups (optional)</Text>
              <View className="flex-row flex-wrap gap-2">
                {DEFAULT_PERSON_GROUPS.map(group => {
                  const selected = groups.includes(group);
                  return <TouchableOpacity key={group} onPress={() => setGroups(current => selected ? current.filter(value => value !== group) : [...current, group])} className={`px-3 py-2 rounded-full border ${selected ? 'bg-indigo-600 border-indigo-600' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}>
                    <Text className={`text-xs font-bold ${selected ? 'text-white' : 'text-slate-600 dark:text-slate-300'}`}>{group}</Text>
                  </TouchableOpacity>;
                })}
              </View>
              <TextInput value={customGroup} onChangeText={setCustomGroup} placeholder="Custom group, e.g. Project team" placeholderTextColor="#94a3b8" className="bg-slate-100 dark:bg-slate-800 rounded-2xl px-4 py-3 mt-3 text-slate-900 dark:text-white" />
              <View className="flex-row gap-3 mt-6">
                <TouchableOpacity disabled={saving} onPress={() => setCreating(false)} className="flex-1 rounded-2xl py-3 items-center bg-slate-100 dark:bg-slate-800"><Text className="font-bold text-slate-700 dark:text-slate-200">Back</Text></TouchableOpacity>
                <TouchableOpacity disabled={saving} onPress={createPerson} className="flex-1 rounded-2xl py-3 items-center bg-indigo-600">{saving ? <ActivityIndicator color="#fff" /> : <Text className="font-bold text-white">Save & link</Text>}</TouchableOpacity>
              </View>
            </View>
          ) : (
            <>
              <TouchableOpacity onPress={() => setContactsOpen(true)} className="flex-row items-center p-3 rounded-2xl bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-900 mb-3"><View className="w-10 h-10 rounded-full bg-teal-600 items-center justify-center mr-3"><FontAwesome name="address-book" size={15} color="#fff" /></View><View className="flex-1"><Text className="font-bold text-teal-800 dark:text-teal-200">Add from phone contacts</Text><Text className="text-xs text-teal-600 dark:text-teal-400 mt-0.5">HisabTrack users have a coin-and-link badge</Text></View><FontAwesome name="chevron-right" size={12} color="#0d9488" /></TouchableOpacity>
              <View className="flex-row items-center bg-slate-100 dark:bg-slate-800 rounded-2xl px-4 mb-3">
                <FontAwesome name="search" size={16} color="#94a3b8" />
                <TextInput value={query} onChangeText={setQuery} placeholder="Search names, aliases or groups" placeholderTextColor="#94a3b8" className="flex-1 px-3 py-3 text-slate-900 dark:text-white" />
              </View>
              <TouchableOpacity onPress={() => { setName(suggestedName?.trim() || query.trim()); setCreating(true); }} className="flex-row items-center p-3 rounded-2xl bg-indigo-50 dark:bg-indigo-950/50 mb-2">
                <View className="w-10 h-10 rounded-full bg-indigo-600 items-center justify-center mr-3"><FontAwesome name="user-plus" size={15} color="#fff" /></View>
                <View className="flex-1"><Text className="font-bold text-indigo-700 dark:text-indigo-300">Save a new person</Text><Text className="text-xs text-indigo-500 dark:text-indigo-400">Create once, then reuse everywhere</Text></View>
              </TouchableOpacity>
              {selectedId && <TouchableOpacity onPress={() => { onSelect(undefined); onClose(); }} className="px-3 py-3"><Text className="font-semibold text-red-500">Remove person link</Text></TouchableOpacity>}
              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} className="max-h-96">
                {shown.map(person => (
                  <TouchableOpacity key={person.id} onPress={() => { onSelect(person); onClose(); }} className={`flex-row items-center p-3 mb-2 rounded-2xl border ${person.id === selectedId ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40' : 'border-slate-200 dark:border-slate-800'}`}>
                    <View className="w-11 h-11 rounded-full bg-teal-100 dark:bg-teal-950 items-center justify-center mr-3"><Text className="font-extrabold text-teal-700 dark:text-teal-300">{person.displayName.slice(0, 1).toUpperCase()}</Text></View>
                    <View className="flex-1"><Text className="font-bold text-slate-900 dark:text-white">{person.displayName}</Text>{(person.groups || []).length > 0 && <Text className="text-xs text-slate-500 dark:text-slate-400 mt-1">{person.groups!.join(' • ')}</Text>}</View>
                    <View className="items-end ml-2">{person.linkedUid && <Text className="text-[10px] font-extrabold text-emerald-600 dark:text-emerald-400 mb-1">LINKED</Text>}{!person.phone && !person.email && <Text className="text-[10px] font-extrabold text-amber-600 dark:text-amber-400 mb-1">CONTACT NEEDED</Text>}{person.id === selectedId && <FontAwesome name="check-circle" size={19} color="#6366f1" />}</View>
                  </TouchableOpacity>
                ))}
                {shown.length === 0 && <Text className="text-center text-slate-500 dark:text-slate-400 py-8">No saved people found.</Text>}
              </ScrollView>
            </>
          )}
    </FormSheet>
    <PhoneContactPicker visible={visible && contactsOpen} onClose={() => setContactsOpen(false)} onSelect={chooseContact} />
  </>;
}
