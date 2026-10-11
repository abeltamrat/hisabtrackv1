import { useItemCatalog } from '@/components/LineItemsEditor';
import { useAppSettings } from '@/contexts/AppSettingsContext';
import type { ItemKind } from '@/types/database';
import { FontAwesome } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { FlatList, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

type KindFilter = 'ALL' | ItemKind;

export default function ItemsScreen() {
  const router = useRouter();
  const { formatCurrency } = useAppSettings();
  const { catalog } = useItemCatalog();
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<KindFilter>('ALL');

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return catalog
      .filter(entry => entry.purchases > 0)
      .filter(entry => kind === 'ALL' || (entry.item.kind ?? 'OTHER') === kind)
      .filter(entry => !q || `${entry.item.name} ${entry.item.category || ''} ${entry.last?.supplier || ''}`.toLowerCase().includes(q))
      .sort((a, b) => (b.last?.date || 0) - (a.last?.date || 0));
  }, [catalog, kind, search]);

  return (
    <View className="flex-1 bg-slate-50 dark:bg-background-dark">
      <Stack.Screen options={{ headerShown: false }} />
      <View className="px-5 pt-5 pb-4 flex-row items-center">
        <TouchableOpacity accessibilityLabel="Go back" onPress={() => router.back()} className="w-11 h-11 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 items-center justify-center"><FontAwesome name="arrow-left" size={16} color="#64748b" /></TouchableOpacity>
        <View className="flex-1 ml-4"><Text className="text-xl font-extrabold text-slate-900 dark:text-white">Items & Prices</Text><Text className="text-xs text-slate-500 dark:text-slate-400">What you buy, what it cost, and where</Text></View>
      </View>

      <View className="px-5">
        <View className="flex-row items-center bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 px-4">
          <FontAwesome name="search" size={16} color="#94a3b8" />
          <TextInput value={search} onChangeText={setSearch} placeholder="Search items or suppliers" placeholderTextColor="#94a3b8" className="flex-1 px-3 py-3 text-slate-900 dark:text-white" />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-3 mb-3">
          {([['ALL', 'All'], ['MATERIAL', 'Materials'], ['TOOL', 'Tools'], ['OTHER', 'Other']] as [KindFilter, string][]).map(([value, label]) => (
            <TouchableOpacity key={value} onPress={() => setKind(value)} className={`mr-2 px-4 py-2 rounded-full ${kind === value ? 'bg-indigo-600' : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700'}`}>
              <Text className={`text-xs font-bold ${kind === value ? 'text-white' : 'text-slate-600 dark:text-slate-300'}`}>{label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <FlatList
        className="flex-1 px-5"
        contentContainerStyle={{ paddingBottom: 32 }}
        data={visible}
        keyExtractor={entry => entry.key}
        renderItem={({ item: entry }) => (
          <TouchableOpacity onPress={() => router.push(`/items/${encodeURIComponent(entry.key)}` as any)} className="flex-row items-center bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 mb-2">
            <View className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-950 items-center justify-center mr-3"><FontAwesome name={entry.item.kind === 'TOOL' ? 'wrench' : entry.item.kind === 'MATERIAL' ? 'cubes' : 'shopping-basket'} size={15} color="#6366f1" /></View>
            <View className="flex-1">
              <Text numberOfLines={1} className="font-bold text-slate-900 dark:text-white">{entry.item.name}{entry.item.source === 'mela' ? '  · Mela' : ''}</Text>
              <Text numberOfLines={1} className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {entry.last ? `Last ${formatCurrency(entry.last.unitPrice)}${entry.unit ? `/${entry.unit}` : ''}${entry.last.supplier ? ` · ${entry.last.supplier}` : ''} · ${new Date(entry.last.date).toLocaleDateString()}` : 'Not bought yet'}
              </Text>
            </View>
            <View className="items-end ml-2">
              <Text className="text-sm font-extrabold text-slate-900 dark:text-white">{formatCurrency(entry.totalSpent)}</Text>
              <Text className="text-[11px] text-slate-500 dark:text-slate-400">{entry.totalQuantity}{entry.unit ? ` ${entry.unit}` : ''}</Text>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View className="items-center py-20">
            <FontAwesome name="shopping-basket" size={42} color="#94a3b8" />
            <Text className="text-lg font-bold text-slate-700 dark:text-slate-200 mt-4">No items yet</Text>
            <Text className="text-sm text-slate-500 dark:text-slate-400 text-center mt-2">Turn on "Itemize purchase" when adding an expense to start tracking prices.</Text>
          </View>
        }
      />
    </View>
  );
}
