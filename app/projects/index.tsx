import { useMelaProjects } from '@/components/ProjectPicker';
import { useAppSettings } from '@/contexts/AppSettingsContext';
import MelaService, { sortProjects } from '@/services/MelaService';
import type { RootState } from '@/store';
import { projectEntries, projectKey, projectTotals, snapshotLinks } from '@/utils/projectFinance';
import { FontAwesome } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSelector } from 'react-redux';

type Filter = 'ACTIVITY' | 'ALL' | 'OPEN';

export default function ProjectsScreen() {
  const router = useRouter();
  const { formatCurrency } = useAppSettings();
  const { projects } = useMelaProjects();
  const transactions = useSelector((state: RootState) => state.transactions.items);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('ACTIVITY');
  const [refreshing, setRefreshing] = useState(false);

  const entries = useMemo(() => projectEntries(transactions), [transactions]);
  const rows = useMemo(() => {
    // Synced projects, plus any project still referenced by a transaction but no longer in Mela's list.
    const fromMela = sortProjects(projects).map(p => ({ key: projectKey({ source: 'mela', id: p.id }), id: p.id, code: p.code, title: p.title, status: p.status, customer: p.customer }));
    const known = new Set(fromMela.map(r => r.key));
    const orphaned = [...snapshotLinks(transactions)].filter(([key]) => !known.has(key)).map(([key, link]) => ({ key, id: link.id, code: link.code ?? null, title: link.title, status: 'Not in Mela', customer: null }));
    return [...fromMela, ...orphaned].map(row => ({ ...row, totals: projectTotals(entries.get(row.key)) }));
  }, [entries, projects, transactions]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter(r => filter === 'ALL' || (filter === 'ACTIVITY' ? r.totals.count > 0 : !/^(done|completed|terminated|cancel)/i.test(r.status || '')))
      .filter(r => !q || `${r.code || ''} ${r.title} ${r.customer || ''} ${r.id}`.toLowerCase().includes(q))
      .sort((a, b) => filter === 'ACTIVITY' ? (b.totals.lastDate || 0) - (a.totals.lastDate || 0) : 0);
  }, [filter, rows, search]);

  const refresh = async () => { setRefreshing(true); try { await MelaService.syncProjects(); } catch { /* status shown on Connections */ } finally { setRefreshing(false); } };

  return (
    <View className="flex-1 bg-slate-50 dark:bg-background-dark">
      <Stack.Screen options={{ headerShown: false }} />
      <View className="px-5 pt-5 pb-4 flex-row items-center">
        <TouchableOpacity accessibilityLabel="Go back" onPress={() => router.back()} className="w-11 h-11 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 items-center justify-center"><FontAwesome name="arrow-left" size={16} color="#64748b" /></TouchableOpacity>
        <View className="flex-1 ml-4"><Text className="text-xl font-extrabold text-slate-900 dark:text-white">Projects</Text><Text className="text-xs text-slate-500 dark:text-slate-400">From Mela ERP · {projects.length} synced</Text></View>
        <TouchableOpacity accessibilityLabel="Connection settings" onPress={() => router.push('/connections' as any)} className="w-11 h-11 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 items-center justify-center"><FontAwesome name="plug" size={16} color="#6366f1" /></TouchableOpacity>
      </View>

      <View className="px-5">
        <View className="flex-row items-center bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 px-4">
          <FontAwesome name="search" size={16} color="#94a3b8" />
          <TextInput value={search} onChangeText={setSearch} placeholder="Search ID, title or customer" placeholderTextColor="#94a3b8" className="flex-1 px-3 py-3 text-slate-900 dark:text-white" />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-3 mb-3">
          {([['ACTIVITY', 'With transactions'], ['OPEN', 'Open'], ['ALL', 'All']] as [Filter, string][]).map(([value, label]) => (
            <TouchableOpacity key={value} onPress={() => setFilter(value)} className={`mr-2 px-4 py-2 rounded-full ${filter === value ? 'bg-indigo-600' : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700'}`}>
              <Text className={`text-xs font-bold ${filter === value ? 'text-white' : 'text-slate-600 dark:text-slate-300'}`}>{label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <FlatList
        className="flex-1 px-5"
        contentContainerStyle={{ paddingBottom: 32 }}
        data={visible}
        keyExtractor={item => item.key}
        initialNumToRender={15}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => router.push(`/projects/${item.id}` as any)} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl p-4 mb-3">
            <View className="flex-row items-center">
              <View className="w-12 h-12 rounded-2xl bg-indigo-100 dark:bg-indigo-950 items-center justify-center mr-3"><FontAwesome name="folder-open" size={18} color="#6366f1" /></View>
              <View className="flex-1">
                <Text numberOfLines={1} className="text-base font-extrabold text-slate-900 dark:text-white">{item.title}</Text>
                <Text numberOfLines={1} className="text-xs text-slate-500 dark:text-slate-400 mt-1">{item.code || `#${item.id}`}{item.status ? ` · ${item.status}` : ''} · {item.totals.count} transaction{item.totals.count === 1 ? '' : 's'}</Text>
              </View>
              <FontAwesome name="chevron-right" size={13} color="#94a3b8" />
            </View>
            {item.totals.count > 0 && (
              <View className="flex-row mt-4 gap-2">
                <View className="flex-1 rounded-2xl bg-red-50 dark:bg-red-950/30 p-3"><Text className="text-[10px] font-bold text-red-600 dark:text-red-400">PAID</Text><Text numberOfLines={1} className="text-sm font-extrabold text-red-700 dark:text-red-300 mt-1">{formatCurrency(item.totals.paid)}</Text></View>
                <View className="flex-1 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 p-3"><Text className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">RECEIVED</Text><Text numberOfLines={1} className="text-sm font-extrabold text-emerald-700 dark:text-emerald-300 mt-1">{formatCurrency(item.totals.received)}</Text></View>
                <View className="flex-1 rounded-2xl bg-indigo-50 dark:bg-indigo-950/30 p-3"><Text className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400">NET</Text><Text numberOfLines={1} className="text-sm font-extrabold text-indigo-700 dark:text-indigo-300 mt-1">{item.totals.net >= 0 ? '+' : '-'}{formatCurrency(Math.abs(item.totals.net))}</Text></View>
              </View>
            )}
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View className="items-center py-20">
            <FontAwesome name="folder-open-o" size={42} color="#94a3b8" />
            <Text className="text-lg font-bold text-slate-700 dark:text-slate-200 mt-4">{filter === 'ACTIVITY' && rows.length ? 'No transactions tagged yet' : 'No projects found'}</Text>
            <Text className="text-sm text-slate-500 dark:text-slate-400 text-center mt-2">{filter === 'ACTIVITY' && rows.length ? 'Choose a project when adding a transaction, or switch to All.' : 'Pull down to sync from Mela.'}</Text>
          </View>
        }
      />
    </View>
  );
}
