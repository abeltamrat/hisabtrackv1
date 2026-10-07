import { FontAwesome } from '@expo/vector-icons';
import React from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

import type { TransactionSplit } from '@/types/database';
import { money, sumMoney } from '@/utils/finance';
import { formatTagInput, parseTagInput } from '@/utils/tags';

type Category = { id: string; name: string };

export default function TransactionSplitEditor({
  total, splits, categories, onChange, formatCurrency,
}: {
  total: number;
  splits: TransactionSplit[];
  categories: Category[];
  onChange: (splits: TransactionSplit[]) => void;
  formatCurrency: (value: number) => string;
}) {
  const allocated = sumMoney(splits.map(item => Number(item.amount) || 0));
  const remaining = money(total - allocated);
  const update = (id: string, patch: Partial<TransactionSplit>) => onChange(splits.map(item => item.id === id ? { ...item, ...patch } : item));
  const add = () => onChange([...splits, {
    id: `split-${Date.now()}-${splits.length}`,
    amount: Math.max(0, remaining),
    category: categories[0]?.name || 'Uncategorized',
  }]);

  return (
    <View className="rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 p-4">
      <View className="flex-row items-center justify-between mb-3">
        <View>
          <Text className="text-slate-900 dark:text-white font-bold">Split transaction</Text>
          <Text className={`text-xs mt-0.5 ${remaining === 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
            {remaining === 0 ? 'Fully allocated' : `${formatCurrency(Math.abs(remaining))} ${remaining > 0 ? 'remaining' : 'over allocated'}`}
          </Text>
        </View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Add split" onPress={add} className="px-3 py-2 rounded-xl bg-indigo-600">
          <Text className="text-white text-xs font-bold">+ Add split</Text>
        </TouchableOpacity>
      </View>
      {splits.map((split, index) => (
        <View key={split.id} className="bg-white dark:bg-slate-900 rounded-xl p-3 mb-3 border border-slate-200 dark:border-slate-700">
          <View className="flex-row items-center mb-2">
            <Text className="text-slate-600 dark:text-slate-300 text-xs font-bold flex-1">Part {index + 1}</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Remove split ${index + 1}`} onPress={() => onChange(splits.filter(item => item.id !== split.id))} className="p-2">
              <FontAwesome name="trash-o" size={15} color="#ef4444" />
            </TouchableOpacity>
          </View>
          <TextInput
            value={split.amount ? String(split.amount) : ''}
            onChangeText={value => update(split.id, { amount: Number(value.replace(',', '.')) || 0 })}
            keyboardType="decimal-pad"
            placeholder="Amount"
            placeholderTextColor="#94a3b8"
            className="bg-slate-50 dark:bg-slate-800 rounded-xl px-3 py-2.5 text-slate-900 dark:text-white mb-2"
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-2">
            {categories.map(category => (
              <TouchableOpacity key={category.id} onPress={() => update(split.id, { category: category.name })} className={`mr-2 px-3 py-2 rounded-xl ${split.category === category.name ? 'bg-indigo-600' : 'bg-slate-100 dark:bg-slate-800'}`}>
                <Text className={`text-[10px] font-semibold ${split.category === category.name ? 'text-white' : 'text-slate-600 dark:text-slate-300'}`}>{category.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TextInput
            value={split.description || ''}
            onChangeText={value => update(split.id, { description: value })}
            placeholder="Description (optional)"
            placeholderTextColor="#94a3b8"
            className="bg-slate-50 dark:bg-slate-800 rounded-xl px-3 py-2.5 text-slate-900 dark:text-white mb-2"
          />
          <TextInput
            value={formatTagInput(split.tags)}
            onChangeText={value => update(split.id, { tags: parseTagInput(value) })}
            placeholder="Tags for this part (comma separated)"
            placeholderTextColor="#94a3b8"
            autoCapitalize="none"
            className="bg-slate-50 dark:bg-slate-800 rounded-xl px-3 py-2.5 text-slate-900 dark:text-white"
          />
        </View>
      ))}
      {splits.length === 1 && <Text className="text-amber-600 text-[10px]">Add at least one more part, or remove this split.</Text>}
    </View>
  );
}
