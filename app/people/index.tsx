import PersonPicker from '@/components/PersonPicker';
import RecipientIdentityService, { type RecipientProfile } from '@/services/RecipientIdentityService';
import LocalChangeEmitter from '@/services/LocalChangeEmitter';
import PeopleFinancialService, { type PeopleMovement } from '@/services/PeopleFinancialService';
import { useAppSettings } from '@/contexts/AppSettingsContext';
import { FontAwesome } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

export default function PeopleScreen() {
  const router = useRouter();
  const { formatCurrency } = useAppSettings();
  const [people, setPeople] = useState<RecipientProfile[]>([]);
  const [movements, setMovements] = useState<PeopleMovement[]>([]);
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('All');
  const [pickerOpen, setPickerOpen] = useState(false);

  const load = useCallback(async () => {
    const [savedPeople, savedMovements] = await Promise.all([RecipientIdentityService.getAll(), PeopleFinancialService.getAllMovements()]);
    setPeople(savedPeople); setMovements(savedMovements);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const unsubscribe = LocalChangeEmitter.subscribe(() => { void load(); });
    return () => { unsubscribe(); };
  }, [load]);

  const active = useMemo(() => people.filter(person => !person.archivedAt), [people]);
  const groups = useMemo(() => ['All', ...new Set(active.flatMap(person => person.groups || []))], [active]);
  const visible = useMemo(() => active.filter(person => {
    if (group !== 'All' && !(person.groups || []).includes(group)) return false;
    const query = search.trim().toLocaleLowerCase();
    return !query || `${person.displayName} ${person.phone || ''} ${person.email || ''} ${(person.aliases || []).join(' ')} ${(person.groups || []).join(' ')}`.toLocaleLowerCase().includes(query);
  }).sort((a, b) => a.displayName.localeCompare(b.displayName)), [active, group, search]);

  const totals = (person: RecipientProfile) => {
    const history = RecipientIdentityService.unifiedHistory(person, movements, people).filter(tx => tx.type !== 'TRANSFER');
    const sent = history.filter(tx => tx.type === 'EXPENSE').reduce((sum, tx) => sum + tx.amount, 0);
    const received = history.filter(tx => tx.type === 'INCOME').reduce((sum, tx) => sum + tx.amount, 0);
    return {
      count: history.length,
      sent,
      received,
      balance: received - sent,
    };
  };

  return (
    <View className="flex-1 bg-slate-50 dark:bg-background-dark">
      <View className="px-5 pt-5 pb-4 flex-row items-center">
        <TouchableOpacity accessibilityLabel="Go back" onPress={() => router.back()} className="w-11 h-11 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 items-center justify-center"><FontAwesome name="arrow-left" size={16} color="#64748b" /></TouchableOpacity>
        <View className="flex-1 ml-4"><Text className="text-xl font-extrabold text-slate-900 dark:text-white">People</Text><Text className="text-xs text-slate-500 dark:text-slate-400">Financial relationships across your records</Text></View>
        <TouchableOpacity accessibilityLabel="Add person" onPress={() => setPickerOpen(true)} className="w-11 h-11 rounded-2xl bg-indigo-600 items-center justify-center"><FontAwesome name="user-plus" size={16} color="#fff" /></TouchableOpacity>
      </View>

      <View className="px-5">
        <View className="flex-row items-center bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 px-4">
          <FontAwesome name="search" size={16} color="#94a3b8" />
          <TextInput value={search} onChangeText={setSearch} placeholder="Search people, aliases or groups" placeholderTextColor="#94a3b8" className="flex-1 px-3 py-3 text-slate-900 dark:text-white" />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-3 mb-3">
          {groups.map(item => <TouchableOpacity key={item} onPress={() => setGroup(item)} className={`mr-2 px-4 py-2 rounded-full ${group === item ? 'bg-indigo-600' : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700'}`}><Text className={`text-xs font-bold ${group === item ? 'text-white' : 'text-slate-600 dark:text-slate-300'}`}>{item}</Text></TouchableOpacity>)}
        </ScrollView>
      </View>

      <ScrollView className="flex-1 px-5" contentContainerStyle={{ paddingBottom: 32 }}>
        {visible.map(person => {
          const stats = totals(person);
          return <TouchableOpacity key={person.id} onPress={() => router.push(`/people/${person.id}` as any)} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl p-4 mb-3">
            <View className="flex-row items-center">
              <View className="w-12 h-12 rounded-2xl bg-teal-100 dark:bg-teal-950 items-center justify-center mr-3"><Text className="text-lg font-extrabold text-teal-700 dark:text-teal-300">{person.displayName.slice(0, 1).toUpperCase()}</Text></View>
              <View className="flex-1"><Text numberOfLines={1} className="text-base font-extrabold text-slate-900 dark:text-white">{person.displayName}</Text><Text numberOfLines={1} className="text-xs text-slate-500 dark:text-slate-400 mt-1">{(person.groups || []).join(' • ') || 'No group'} · {stats.count} movement{stats.count === 1 ? '' : 's'}</Text></View>
              <FontAwesome name="chevron-right" size={13} color="#94a3b8" />
            </View>
            <View className="flex-row mt-4 gap-2">
              <View className="flex-1 rounded-2xl bg-red-50 dark:bg-red-950/30 p-3"><Text className="text-[10px] font-bold text-red-600 dark:text-red-400">SENT</Text><Text numberOfLines={1} className="text-sm font-extrabold text-red-700 dark:text-red-300 mt-1">{formatCurrency(stats.sent)}</Text></View>
              <View className="flex-1 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 p-3"><Text className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">RECEIVED</Text><Text numberOfLines={1} className="text-sm font-extrabold text-emerald-700 dark:text-emerald-300 mt-1">{formatCurrency(stats.received)}</Text></View>
              <View className="flex-1 rounded-2xl bg-indigo-50 dark:bg-indigo-950/30 p-3"><Text className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400">BALANCE</Text><Text numberOfLines={1} className="text-sm font-extrabold text-indigo-700 dark:text-indigo-300 mt-1">{stats.balance >= 0 ? '+' : '-'}{formatCurrency(Math.abs(stats.balance))}</Text></View>
            </View>
          </TouchableOpacity>;
        })}
        {visible.length === 0 && <View className="items-center py-20"><FontAwesome name="users" size={42} color="#94a3b8" /><Text className="text-lg font-bold text-slate-700 dark:text-slate-200 mt-4">No people found</Text><Text className="text-sm text-slate-500 dark:text-slate-400 text-center mt-2">Save a person from a transaction or use the add button.</Text></View>}
      </ScrollView>
      <PersonPicker visible={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={person => { if (person) router.push(`/people/${person.id}` as any); }} />
    </View>
  );
}
