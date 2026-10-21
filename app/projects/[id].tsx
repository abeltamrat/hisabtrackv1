import { useMelaProjects } from '@/components/ProjectPicker';
import { useAppSettings } from '@/contexts/AppSettingsContext';
import type { RootState } from '@/store';
import { projectEntries, projectKey, projectTotals, snapshotLinks } from '@/utils/projectFinance';
import { itemBreakdown, purchaseRecords } from '@/utils/itemFinance';
import { FontAwesome } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useSelector } from 'react-redux';
import { projectBudgetMetrics } from '@/utils/projectReview';

type Direction = 'ALL' | 'PAID' | 'RECEIVED';

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { formatCurrency } = useAppSettings();
  const { projects } = useMelaProjects();
  const transactions = useSelector((state: RootState) => state.transactions.items);
  const accounts = useSelector((state: RootState) => state.accounts.items);
  const [direction, setDirection] = useState<Direction>('ALL');

  const key = projectKey({ source: 'mela', id: Number(id) });
  const synced = projects.find(p => p.id === Number(id));
  const snapshot = useMemo(() => snapshotLinks(transactions).get(key), [key, transactions]);
  const entries = useMemo(() => (projectEntries(transactions).get(key) ?? []).sort((a, b) => b.transaction.date - a.transaction.date), [key, transactions]);
  const filtered = entries.filter(e => direction === 'ALL' || (direction === 'PAID' ? e.transaction.type === 'EXPENSE' : e.transaction.type === 'INCOME'));
  const totals = projectTotals(entries);
  const budgetMetrics = projectBudgetMetrics(synced?.budget, totals.paid);
  const items = useMemo(() => itemBreakdown(purchaseRecords(transactions).filter(r => r.project && projectKey(r.project) === key)), [key, transactions]);
  const accountName = (accountId: string) => accounts.find(a => a.id === accountId)?.name;

  const title = synced?.title || snapshot?.title;
  if (!title) {
    return <View className="flex-1 bg-slate-50 dark:bg-background-dark items-center justify-center"><Stack.Screen options={{ headerShown: false }} /><Text className="text-slate-500 dark:text-slate-400">Project not found</Text><TouchableOpacity onPress={() => router.back()} className="mt-4 px-4 py-2 bg-indigo-600 rounded-xl"><Text className="text-white font-bold">Go back</Text></TouchableOpacity></View>;
  }

  return (
    <View className="flex-1 bg-slate-50 dark:bg-background-dark">
      <Stack.Screen options={{ headerShown: false }} />
      <View className="px-5 pt-5 pb-4 flex-row items-center">
        <TouchableOpacity accessibilityLabel="Go back" onPress={() => router.back()} className="w-11 h-11 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 items-center justify-center"><FontAwesome name="arrow-left" size={16} color="#64748b" /></TouchableOpacity>
        <View className="flex-1 ml-4"><Text numberOfLines={1} className="text-xl font-extrabold text-slate-900 dark:text-white">{title}</Text><Text className="text-xs text-slate-500 dark:text-slate-400">Project statement</Text></View>
      </View>

      <ScrollView className="flex-1 px-5" contentContainerStyle={{ paddingBottom: 36 }}>
        <View className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 mb-3">
          <Text className="text-sm font-extrabold text-slate-900 dark:text-white mb-2">Project details</Text>
          <Text className="text-xs text-slate-600 dark:text-slate-300 mb-1"><Text className="font-bold">Project ID: </Text>{synced?.code || snapshot?.code || `#${id}`}</Text>
          <Text className="text-xs text-slate-600 dark:text-slate-300 mb-1"><Text className="font-bold">Title: </Text>{title}</Text>
          {synced?.customer && <Text className="text-xs text-slate-600 dark:text-slate-300 mb-1"><Text className="font-bold">Customer: </Text>{synced.customer}</Text>}
          <Text className="text-xs text-slate-600 dark:text-slate-300"><Text className="font-bold">Status: </Text>{synced?.status || 'Not in Mela'}</Text>
          {!synced && <Text className="text-[11px] text-amber-700 dark:text-amber-300 mt-2">This project is no longer in the synced Mela list; showing the name saved on your transactions.</Text>}
        </View>

        <View className="flex-row gap-2 mb-1">
          <View className="flex-1 p-3 rounded-2xl bg-red-50 dark:bg-red-950/30"><Text className="text-[10px] font-bold text-red-600 dark:text-red-400">PAID</Text><Text numberOfLines={1} className="text-base font-extrabold text-red-700 dark:text-red-300 mt-1">{formatCurrency(totals.paid)}</Text></View>
          <View className="flex-1 p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30"><Text className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">RECEIVED</Text><Text numberOfLines={1} className="text-base font-extrabold text-emerald-700 dark:text-emerald-300 mt-1">{formatCurrency(totals.received)}</Text></View>
          <View className="flex-1 p-3 rounded-2xl bg-indigo-50 dark:bg-indigo-950/30"><Text className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400">NET</Text><Text numberOfLines={1} className="text-base font-extrabold text-indigo-700 dark:text-indigo-300 mt-1">{totals.net >= 0 ? '+' : '-'}{formatCurrency(Math.abs(totals.net))}</Text></View>
        </View>
        <Text className="text-[10px] text-slate-500 dark:text-slate-400 mb-3">Net is received minus paid. Split parts and item lines count only the amount tagged with this project.</Text>

        <View className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 mb-3">
          <View className="flex-row justify-between items-center mb-3"><Text className="text-sm font-extrabold text-slate-900 dark:text-white">Budget versus actual cost</Text><Text className={`text-xs font-extrabold ${budgetMetrics.status === 'OVER' ? 'text-red-600' : budgetMetrics.status === 'NEAR' ? 'text-amber-600' : 'text-emerald-600'}`}>{budgetMetrics.status === 'NO_BUDGET' ? 'Unavailable' : budgetMetrics.status.replace('_', ' ')}</Text></View>
          {budgetMetrics.budget ? <>
            <View className="flex-row gap-2 mb-3"><View className="flex-1"><Text className="text-[10px] text-slate-500 dark:text-slate-400 font-bold">MELA ESTIMATE</Text><Text className="text-base font-extrabold text-slate-900 dark:text-white mt-1">{formatCurrency(budgetMetrics.budget)}</Text></View><View className="flex-1"><Text className="text-[10px] text-slate-500 dark:text-slate-400 font-bold">REMAINING</Text><Text className={`text-base font-extrabold mt-1 ${(budgetMetrics.remaining || 0) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{(budgetMetrics.remaining || 0) < 0 ? '-' : ''}{formatCurrency(Math.abs(budgetMetrics.remaining || 0))}</Text></View></View>
            <View className="h-3 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden"><View style={{ width: `${Math.min(100, budgetMetrics.percent || 0)}%` }} className={`h-full ${budgetMetrics.status === 'OVER' ? 'bg-red-500' : budgetMetrics.status === 'NEAR' ? 'bg-amber-500' : 'bg-emerald-500'}`} /></View>
            <Text className="text-[11px] text-slate-500 dark:text-slate-400 mt-2">Actual project cost is {Math.round(budgetMetrics.percent || 0)}% of the estimate imported from Mela.</Text>
          </> : <Text className="text-xs text-slate-500 dark:text-slate-400">Mela has not supplied an estimate for this project. Actual paid cost remains visible above.</Text>}
        </View>

        {items.rows.length > 0 && (
          <View className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 mb-3">
            <Text className="text-sm font-extrabold text-slate-900 dark:text-white mb-2">Materials & tools</Text>
            <View className="flex-row gap-2 mb-2">
              <View className="flex-1 rounded-xl bg-amber-50 dark:bg-amber-950/30 p-2"><Text className="text-[10px] font-bold text-amber-700 dark:text-amber-300">MATERIALS</Text><Text numberOfLines={1} className="text-sm font-extrabold text-amber-800 dark:text-amber-200">{formatCurrency(items.byKind.MATERIAL)}</Text></View>
              <View className="flex-1 rounded-xl bg-sky-50 dark:bg-sky-950/30 p-2"><Text className="text-[10px] font-bold text-sky-700 dark:text-sky-300">TOOLS</Text><Text numberOfLines={1} className="text-sm font-extrabold text-sky-800 dark:text-sky-200">{formatCurrency(items.byKind.TOOL)}</Text></View>
              <View className="flex-1 rounded-xl bg-slate-100 dark:bg-slate-900 p-2"><Text className="text-[10px] font-bold text-slate-600 dark:text-slate-300">OTHER</Text><Text numberOfLines={1} className="text-sm font-extrabold text-slate-800 dark:text-slate-200">{formatCurrency(items.byKind.OTHER)}</Text></View>
            </View>
            {items.rows.map(row => (
              <TouchableOpacity key={row.key} onPress={() => router.push(`/items/${encodeURIComponent(row.key)}` as any)} className="flex-row justify-between py-2 border-b border-slate-100 dark:border-slate-700">
                <Text numberOfLines={1} className="flex-1 mr-2 text-sm text-slate-900 dark:text-white">{row.item.name}</Text>
                <Text className="text-xs text-slate-500 dark:text-slate-400 mr-3">{row.quantity}{row.unit ? ` ${row.unit}` : ''}</Text>
                <Text className="text-sm font-bold text-slate-900 dark:text-white">{formatCurrency(row.amount)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-3">
          {([['ALL', 'All'], ['PAID', 'Paid'], ['RECEIVED', 'Received']] as [Direction, string][]).map(([value, label]) => (
            <TouchableOpacity key={value} onPress={() => setDirection(value)} className={`mr-2 px-4 py-2 rounded-full ${direction === value ? 'bg-indigo-600' : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700'}`}>
              <Text className={`text-xs font-bold ${direction === value ? 'text-white' : 'text-slate-600 dark:text-slate-300'}`}>{label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text className="text-sm font-extrabold text-slate-900 dark:text-white mb-3">{filtered.length} transaction{filtered.length === 1 ? '' : 's'}</Text>
        {filtered.map(({ transaction: tx, amount, splitId, lineId }) => {
          const split = splitId ? tx.splits?.find(s => s.id === splitId) : undefined;
          const line = lineId ? tx.lines?.find(l => l.id === lineId) : undefined;
          const income = tx.type === 'INCOME';
          return (
            <TouchableOpacity key={`${tx.id}-${splitId || lineId || 'all'}`} onPress={() => router.push(`/transaction/${tx.id}` as any)} className="flex-row items-center p-4 mb-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl">
              <View className={`w-10 h-10 rounded-xl items-center justify-center mr-3 ${income ? 'bg-emerald-100 dark:bg-emerald-950' : 'bg-red-100 dark:bg-red-950'}`}><FontAwesome name={income ? 'arrow-down' : 'arrow-up'} size={14} color={income ? '#059669' : '#dc2626'} /></View>
              <View className="flex-1">
                <Text numberOfLines={1} className="font-bold text-slate-900 dark:text-white">{line ? `${line.item.name} · ${line.quantity}${line.unit ? ` ${line.unit}` : ''}` : split?.description || tx.description}</Text>
                <Text numberOfLines={1} className="text-xs text-slate-500 dark:text-slate-400 mt-1">{new Date(tx.date).toLocaleDateString()} · {split?.category || tx.category}{accountName(tx.account_id) ? ` · ${accountName(tx.account_id)}` : ''}{split ? ' · split part' : line ? ' · item' : ''}</Text>
              </View>
              <Text className={`font-extrabold ${income ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{income ? '+' : '-'}{formatCurrency(amount)}</Text>
            </TouchableOpacity>
          );
        })}
        {filtered.length === 0 && <Text className="text-center text-slate-500 dark:text-slate-400 py-12">No transactions are tagged with this project yet.</Text>}
      </ScrollView>
    </View>
  );
}
