import { useItemCatalog } from '@/components/LineItemsEditor';
import { useAppSettings } from '@/contexts/AppSettingsContext';
import { priceInsight, supplierStats } from '@/utils/itemFinance';
import { money, sumMoney } from '@/utils/finance';
import { FontAwesome } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';

export default function ItemDetailScreen() {
  const { key: rawKey } = useLocalSearchParams<{ key: string }>();
  const key = decodeURIComponent(String(rawKey || ''));
  const router = useRouter();
  const { formatCurrency } = useAppSettings();
  const { records, catalog } = useItemCatalog();

  const entry = catalog.find(e => e.key === key);
  const history = useMemo(() => records.filter(r => r.key === key && r.type === 'EXPENSE'), [key, records]);
  const insight = useMemo(() => priceInsight(records, key), [key, records]);
  const suppliers = useMemo(() => supplierStats(records, key), [key, records]);
  const byProject = useMemo(() => {
    const map = new Map<string, { title: string; quantity: number; amount: number[] }>();
    for (const r of history) {
      const title = r.project?.title || 'No project';
      const row = map.get(title) ?? { title, quantity: 0, amount: [] };
      row.quantity += r.quantity; row.amount.push(r.amount); map.set(title, row);
    }
    return [...map.values()].map(r => ({ ...r, total: sumMoney(r.amount) })).sort((a, b) => b.total - a.total);
  }, [history]);
  const maxPrice = Math.max(...history.slice(0, 12).map(r => r.unitPrice), 1);

  if (!entry) {
    return <View className="flex-1 bg-slate-50 dark:bg-background-dark items-center justify-center"><Stack.Screen options={{ headerShown: false }} /><Text className="text-slate-500 dark:text-slate-400">Item not found</Text><TouchableOpacity onPress={() => router.back()} className="mt-4 px-4 py-2 bg-indigo-600 rounded-xl"><Text className="text-white font-bold">Go back</Text></TouchableOpacity></View>;
  }
  const unit = entry.unit ? `/${entry.unit}` : '';

  return (
    <View className="flex-1 bg-slate-50 dark:bg-background-dark">
      <Stack.Screen options={{ headerShown: false }} />
      <View className="px-5 pt-5 pb-4 flex-row items-center">
        <TouchableOpacity accessibilityLabel="Go back" onPress={() => router.back()} className="w-11 h-11 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 items-center justify-center"><FontAwesome name="arrow-left" size={16} color="#64748b" /></TouchableOpacity>
        <View className="flex-1 ml-4"><Text numberOfLines={1} className="text-xl font-extrabold text-slate-900 dark:text-white">{entry.item.name}</Text><Text className="text-xs text-slate-500 dark:text-slate-400">{entry.item.kind === 'TOOL' ? 'Tool' : entry.item.kind === 'MATERIAL' ? 'Material' : 'Item'}{entry.item.source === 'mela' ? ' · from Mela' : ''}</Text></View>
      </View>

      <ScrollView className="flex-1 px-5" contentContainerStyle={{ paddingBottom: 36 }}>
        <View className="flex-row gap-2 mb-3">
          <Stat label="LAST" value={insight.last ? `${formatCurrency(insight.last.unitPrice)}${unit}` : '—'} tone="indigo" />
          <Stat label="BEST 90 DAYS" value={insight.best ? `${formatCurrency(insight.best.unitPrice)}${unit}` : '—'} tone="emerald" />
          <Stat label="USUAL" value={insight.typical !== undefined ? `${formatCurrency(money(insight.typical))}${unit}` : '—'} tone="slate" />
        </View>
        <View className="flex-row gap-2 mb-4">
          <Stat label="TOTAL BOUGHT" value={`${entry.totalQuantity}${entry.unit ? ` ${entry.unit}` : ''}`} tone="slate" />
          <Stat label="TOTAL SPENT" value={formatCurrency(entry.totalSpent)} tone="red" />
        </View>

        {history.length > 1 && (
          <View className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 mb-3">
            <Text className="text-sm font-extrabold text-slate-900 dark:text-white mb-3">Price trend (latest {Math.min(history.length, 12)})</Text>
            <View className="flex-row items-end" style={{ height: 80, gap: 4 }}>
              {[...history.slice(0, 12)].reverse().map(r => (
                <View key={`${r.transactionId}-${r.lineId}`} className="flex-1 rounded-t bg-indigo-400 dark:bg-indigo-500" style={{ height: Math.max(4, (r.unitPrice / maxPrice) * 80) }} />
              ))}
            </View>
          </View>
        )}

        {suppliers.length > 0 && (
          <View className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 mb-3">
            <Text className="text-sm font-extrabold text-slate-900 dark:text-white mb-2">Suppliers (cheapest first)</Text>
            {suppliers.map((s, index) => (
              <View key={s.supplier} className="flex-row justify-between py-2 border-b border-slate-100 dark:border-slate-700">
                <View className="flex-1 mr-2"><Text numberOfLines={1} className="text-sm font-bold text-slate-900 dark:text-white">{index === 0 && suppliers.length > 1 ? '★ ' : ''}{s.supplier}</Text><Text className="text-[11px] text-slate-500 dark:text-slate-400">{s.purchases} purchase{s.purchases === 1 ? '' : 's'} · last {formatCurrency(s.lastPrice)} on {new Date(s.lastDate).toLocaleDateString()}</Text></View>
                <Text className="text-sm font-extrabold text-slate-900 dark:text-white">{formatCurrency(s.averagePrice)}{unit}</Text>
              </View>
            ))}
          </View>
        )}

        {byProject.some(p => p.title !== 'No project') && (
          <View className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 mb-3">
            <Text className="text-sm font-extrabold text-slate-900 dark:text-white mb-2">By project</Text>
            {byProject.map(p => (
              <View key={p.title} className="flex-row justify-between py-2 border-b border-slate-100 dark:border-slate-700">
                <Text numberOfLines={1} className="flex-1 mr-2 text-sm text-slate-900 dark:text-white">{p.title}</Text>
                <Text className="text-xs text-slate-500 dark:text-slate-400 mr-3">{p.quantity}{entry.unit ? ` ${entry.unit}` : ''}</Text>
                <Text className="text-sm font-bold text-slate-900 dark:text-white">{formatCurrency(p.total)}</Text>
              </View>
            ))}
          </View>
        )}

        <Text className="text-sm font-extrabold text-slate-900 dark:text-white mt-2 mb-3">Purchases</Text>
        {history.map(r => (
          <TouchableOpacity key={`${r.transactionId}-${r.lineId}`} onPress={() => router.push(`/transaction/${r.transactionId}` as any)} className="flex-row items-center p-4 mb-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl">
            <View className="flex-1">
              <Text className="font-bold text-slate-900 dark:text-white">{r.quantity}{r.unit ? ` ${r.unit}` : ''} × {formatCurrency(r.unitPrice)}</Text>
              <Text numberOfLines={1} className="text-xs text-slate-500 dark:text-slate-400 mt-1">{new Date(r.date).toLocaleDateString()}{r.supplier ? ` · ${r.supplier}` : ''}{r.project ? ` · ${r.project.title}` : ''}</Text>
            </View>
            <Text className="font-extrabold text-red-600 dark:text-red-400">{formatCurrency(r.amount)}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: 'indigo' | 'emerald' | 'slate' | 'red' }) {
  const bg = { indigo: 'bg-indigo-50 dark:bg-indigo-950/30', emerald: 'bg-emerald-50 dark:bg-emerald-950/30', slate: 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700', red: 'bg-red-50 dark:bg-red-950/30' }[tone];
  const fg = { indigo: 'text-indigo-700 dark:text-indigo-300', emerald: 'text-emerald-700 dark:text-emerald-300', slate: 'text-slate-900 dark:text-white', red: 'text-red-700 dark:text-red-300' }[tone];
  return <View className={`flex-1 p-3 rounded-2xl ${bg}`}><Text className="text-[10px] font-bold text-slate-500 dark:text-slate-400">{label}</Text><Text numberOfLines={1} adjustsFontSizeToFit className={`text-sm font-extrabold mt-1 ${fg}`}>{value}</Text></View>;
}
