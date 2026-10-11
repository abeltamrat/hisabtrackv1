import { FontAwesome } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';

import CategoryTreeSelect, { type TreeCategory } from '@/components/CategoryTreeSelect';
import LineItemsEditor from '@/components/LineItemsEditor';
import TagInputField from '@/components/TagInputField';
import { ProjectField, useMelaProjects } from '@/components/ProjectPicker';
import type { PurchaseLine, TransactionSplit } from '@/types/database';
import { money, sumMoney } from '@/utils/finance';

type Category = TreeCategory;

export default function TransactionSplitEditor({
  total, splits, categories, onChange, formatCurrency, tagSuggestions = [], tagSuggestionsForCategory,
  lines, onLinesChange,
}: {
  total: number;
  splits: TransactionSplit[];
  categories: Category[];
  onChange: (splits: TransactionSplit[]) => void;
  formatCurrency: (value: number) => string;
  tagSuggestions?: string[];
  tagSuggestionsForCategory?: (category: string) => string[];
  /** With these, each part can be itemized on its own (items carry the part's split_id). */
  lines?: PurchaseLine[];
  onLinesChange?: (lines: PurchaseLine[]) => void;
}) {
  // Parts ticked "This is a project cost" (parts that already have a project start ticked).
  // Not every part of a payment is project money, so each part decides on its own.
  const { connected } = useMelaProjects();
  const [projectParts, setProjectParts] = useState(() => new Set(splits.filter(split => split.project).map(split => split.id)));
  const isProjectPart = (split: TransactionSplit) => projectParts.has(split.id) || !!split.project;
  const toggleProject = (split: TransactionSplit) => {
    const next = new Set(projectParts);
    if (isProjectPart(split)) { next.delete(split.id); update(split.id, { project: undefined }); } else next.add(split.id);
    setProjectParts(next);
  };
  // Parts ticked "Itemize this part" (parts that already have items start ticked).
  const [itemized, setItemized] = useState(() => new Set((lines || []).map(line => line.split_id).filter((id): id is string => !!id)));
  const partLines = (splitId: string) => (lines || []).filter(line => line.split_id === splitId);
  const setPartLines = (splitId: string, next: PurchaseLine[]) =>
    onLinesChange?.([...(lines || []).filter(line => line.split_id !== splitId), ...next.map(line => ({ ...line, split_id: splitId }))]);
  const toggleItemize = (splitId: string) => {
    const next = new Set(itemized);
    if (next.has(splitId)) { next.delete(splitId); setPartLines(splitId, []); } else next.add(splitId);
    setItemized(next);
  };
  const remove = (splitId: string) => {
    onChange(splits.filter(item => item.id !== splitId));
    if (partLines(splitId).length) onLinesChange?.((lines || []).filter(line => line.split_id !== splitId));
  };
  const allocated = sumMoney(splits.map(item => Number(item.amount) || 0));
  const remaining = money(total - allocated);
  const update = (id: string, patch: Partial<TransactionSplit>) => onChange(splits.map(item => item.id === id ? { ...item, ...patch } : item));
  const add = () => onChange([...splits, {
    id: `split-${Date.now()}-${splits.length}`,
    amount: Math.max(0, remaining),
    category: categories[0]?.name || 'Uncategorized',
  }]);

  // Tags already used on sibling parts are the likeliest next pick, so they
  // join the saved list even before they reach a recorded transaction.
  const suggestionPool = useMemo(() => {
    const pool = new Map<string, string>();
    for (const tag of [...splits.flatMap(split => split.tags || []), ...tagSuggestions]) {
      if (typeof tag !== 'string') continue;
      const trimmed = tag.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (!pool.has(key)) pool.set(key, trimmed);
    }
    return [...pool.values()];
  }, [splits, tagSuggestions]);

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
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Remove split ${index + 1}`} onPress={() => remove(split.id)} className="p-2">
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
          <View className="mb-2">
            <CategoryTreeSelect
              categories={categories}
              value={split.category}
              onChange={name => update(split.id, { category: name })}
              accessibilityLabel={`Category for part ${index + 1}`}
              placeholder="Choose a category"
              compact
            />
          </View>
          <TextInput
            value={split.description || ''}
            onChangeText={value => update(split.id, { description: value })}
            placeholder="Description (optional)"
            placeholderTextColor="#94a3b8"
            className="bg-slate-50 dark:bg-slate-800 rounded-xl px-3 py-2.5 text-slate-900 dark:text-white mb-2"
          />
          <TagInputField
            tags={split.tags}
            suggestions={tagSuggestionsForCategory
              ? [...(split.tags || []), ...tagSuggestionsForCategory(split.category), ...suggestionPool]
              : suggestionPool}
            onChange={value => update(split.id, { tags: value })}
            placeholder="Tag this part"
            savedLabel="Saved tags"
            compact
          />
          {(connected || split.project) && (
            <>
              <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: isProjectPart(split) }} accessibilityLabel={`Part ${index + 1} is a project cost`} onPress={() => toggleProject(split)} className="flex-row items-center mt-2 py-1.5">
                <FontAwesome name={isProjectPart(split) ? 'check-square' : 'square-o'} size={16} color={isProjectPart(split) ? '#0d9488' : '#94a3b8'} />
                <FontAwesome name="folder-open" size={11} color="#0d9488" style={{ marginLeft: 8 }} />
                <Text className="ml-1.5 text-xs font-bold text-slate-700 dark:text-slate-200">This is a project cost</Text>
              </TouchableOpacity>
              {isProjectPart(split) && <View className="mt-1"><ProjectField value={split.project} onChange={value => update(split.id, { project: value })} compact /></View>}
            </>
          )}
          {onLinesChange && (
            <>
              <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: itemized.has(split.id) }} accessibilityLabel={`Itemize part ${index + 1}`} onPress={() => toggleItemize(split.id)} className="flex-row items-center mt-2 py-1.5">
                <FontAwesome name={itemized.has(split.id) ? 'check-square' : 'square-o'} size={16} color={itemized.has(split.id) ? '#f97316' : '#94a3b8'} />
                <FontAwesome name="shopping-basket" size={11} color="#f97316" style={{ marginLeft: 8 }} />
                <Text className="ml-1.5 text-xs font-bold text-slate-700 dark:text-slate-200">Itemize this part</Text>
              </TouchableOpacity>
              {itemized.has(split.id) && (
                <View className="mt-2">
                  <LineItemsEditor lines={partLines(split.id)} onChange={next => setPartLines(split.id, next)} total={Number(split.amount) || 0} formatCurrency={formatCurrency} showProject={false} />
                </View>
              )}
            </>
          )}
        </View>
      ))}
      {splits.length === 1 && <Text className="text-amber-600 text-[10px]">Add at least one more part, or remove this split.</Text>}
    </View>
  );
}
