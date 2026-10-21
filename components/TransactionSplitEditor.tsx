import { FontAwesome } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';

import CategoryTreeSelect, { type TreeCategory } from '@/components/CategoryTreeSelect';
import LineItemsEditor from '@/components/LineItemsEditor';
import TagInputField from '@/components/TagInputField';
import { ProjectField, useMelaProjects } from '@/components/ProjectPicker';
import type { PurchaseLine, TransactionSplit } from '@/types/database';
import { money, sumMoney } from '@/utils/finance';
import { commonSplitProject } from '@/utils/projectFinance';

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
  const projectSignature = splits.map(split => `${split.id}:${split.project?.source || ''}:${split.project?.id || ''}`).join('|');
  useEffect(() => setProjectParts(new Set(splits.filter(split => split.project).map(split => split.id))), [projectSignature]);
  const isProjectPart = (split: TransactionSplit) => projectParts.has(split.id) || !!split.project;
  const toggleProject = (split: TransactionSplit) => {
    const next = new Set(projectParts);
    if (isProjectPart(split)) { next.delete(split.id); update(split.id, { project: undefined }); } else next.add(split.id);
    setProjectParts(next);
  };
  // Parts ticked "Itemize this part" (parts that already have items start ticked).
  const [itemized, setItemized] = useState(() => new Set((lines || []).map(line => line.split_id).filter((id): id is string => !!id)));
  const partLines = (splitId: string) => (lines || []).filter(line => line.split_id === splitId);
  const partItemsTotal = (splitId: string) => sumMoney(partLines(splitId).map(line => line.amount));
  // Itemized parts whose amount follows their items. Typing an amount stops it, so a
  // part can carry costs that are not itemized (e.g. delivery); the difference shows.
  const [autoAmount, setAutoAmount] = useState(() => new Set(splits
    .filter(split => partLines(split.id).length > 0 && partItemsTotal(split.id) === money(Number(split.amount) || 0))
    .map(split => split.id)));
  const setAuto = (splitId: string, on: boolean) => setAutoAmount(previous => {
    const next = new Set(previous);
    if (on) next.add(splitId); else next.delete(splitId);
    return next;
  });
  const setPartLines = (splitId: string, next: PurchaseLine[]) => {
    onLinesChange?.([...(lines || []).filter(line => line.split_id !== splitId), ...next.map(line => ({ ...line, split_id: splitId }))]);
    if (autoAmount.has(splitId)) update(splitId, { amount: sumMoney(next.map(line => line.amount)) });
  };
  const toggleItemize = (split: TransactionSplit) => {
    const next = new Set(itemized);
    if (next.has(split.id)) {
      // Clearing the items keeps the amount; it becomes a plain part again.
      next.delete(split.id);
      setAuto(split.id, false);
      onLinesChange?.((lines || []).filter(line => line.split_id !== split.id));
    } else {
      next.add(split.id);
      // An empty part takes its amount from the items; a typed amount is kept.
      if (!Number(split.amount)) setAuto(split.id, true);
    }
    setItemized(next);
  };
  const remove = (splitId: string) => {
    onChange(splits.filter(item => item.id !== splitId));
    if (partLines(splitId).length) onLinesChange?.((lines || []).filter(line => line.split_id !== splitId));
  };
  const allocated = sumMoney(splits.map(item => Number(item.amount) || 0));
  const remaining = money(total - allocated);
  const update = (id: string, patch: Partial<TransactionSplit>) => onChange(splits.map(item => item.id === id ? { ...item, ...patch } : item));
  const add = () => {
    const sharedCategory = splits[0]?.category && splits.every(split => split.category === splits[0].category) ? splits[0].category : undefined;
    onChange([...splits, {
      id: `split-${Date.now()}-${splits.length}`,
      amount: Math.max(0, remaining),
      category: sharedCategory || categories[0]?.name || 'Uncategorized',
      project: commonSplitProject(splits),
    }]);
  };

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

  const progress = total > 0 ? Math.min(1, allocated / total) : 0;
  const statusColor = remaining === 0 ? 'text-emerald-600 dark:text-emerald-400' : remaining > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400';

  return (
    <View className="rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 p-4">
      <View className="flex-row items-center justify-between">
        <View className="flex-1 mr-3">
          <Text className="text-slate-900 dark:text-white font-bold">Split transaction</Text>
          <Text className={`text-xs mt-0.5 ${statusColor}`}>
            {remaining === 0 ? `${formatCurrency(total)} fully allocated` : `${formatCurrency(Math.abs(remaining))} ${remaining > 0 ? 'left' : 'over allocated'} of ${formatCurrency(total)}`}
          </Text>
        </View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Add split" onPress={add} className="px-3 py-2 rounded-xl bg-indigo-600">
          <Text className="text-white text-xs font-bold">+ Add part</Text>
        </TouchableOpacity>
      </View>
      <View className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 mt-2 mb-3 overflow-hidden">
        <View className={`h-full rounded-full ${remaining === 0 ? 'bg-emerald-500' : remaining > 0 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${(remaining < 0 ? 1 : progress) * 100}%` }} />
      </View>
      {splits.map((split, index) => {
        const isItemized = itemized.has(split.id);
        const followsItems = isItemized && autoAmount.has(split.id);
        const amount = Number(split.amount) || 0;
        const isLast = index === splits.length - 1;
        return (
          <View key={split.id} className="bg-white dark:bg-slate-900 rounded-xl p-3 mb-3 border border-slate-200 dark:border-slate-700">
            <View className="flex-row items-center mb-2">
              <Text className="text-slate-600 dark:text-slate-300 text-xs font-bold flex-1">Part {index + 1}</Text>
              <Text className="text-slate-900 dark:text-white text-sm font-bold">{formatCurrency(amount)}</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Remove split ${index + 1}`} onPress={() => remove(split.id)} className="p-2 ml-1">
                <FontAwesome name="trash-o" size={15} color="#ef4444" />
              </TouchableOpacity>
            </View>
            <CategoryTreeSelect
              categories={categories}
              value={split.category}
              onChange={name => update(split.id, { category: name })}
              accessibilityLabel={`Category for part ${index + 1}`}
              placeholder="Choose a category"
              compact
            />

            {/* What kind of part this is decides what the rest of the card asks for. */}
            {(connected || split.project || onLinesChange) && (
              <View className="flex-row flex-wrap gap-2 mt-2">
                {(connected || split.project) && (
                  <OptionChip
                    checked={isProjectPart(split)}
                    icon="folder-open"
                    color="#0d9488"
                    label="Project cost"
                    accessibilityLabel={`Part ${index + 1}: This is a project cost`}
                    onPress={() => toggleProject(split)}
                  />
                )}
                {onLinesChange && (
                  <OptionChip
                    checked={isItemized}
                    icon="shopping-basket"
                    color="#f97316"
                    label="Itemize"
                    accessibilityLabel={`Itemize part ${index + 1} (Itemize this part)`}
                    onPress={() => toggleItemize(split)}
                  />
                )}
              </View>
            )}
            {isProjectPart(split) && <View className="mt-2"><ProjectField value={split.project} onChange={value => update(split.id, { project: value })} compact /></View>}

            <View className="flex-row items-center mt-2 bg-slate-50 dark:bg-slate-800 rounded-xl pr-3">
              <TextInput
                value={split.amount ? String(split.amount) : ''}
                onChangeText={value => { setAuto(split.id, false); update(split.id, { amount: Number(value.replace(',', '.')) || 0 }); }}
                keyboardType="decimal-pad"
                placeholder="Amount"
                placeholderTextColor="#94a3b8"
                accessibilityLabel={`Amount for part ${index + 1}`}
                className="flex-1 px-3 py-2.5 text-slate-900 dark:text-white"
              />
              {followsItems && <Text className="text-[10px] font-bold text-orange-600 dark:text-orange-400">from items</Text>}
            </View>
            {isLast && remaining > 0 && !followsItems && (
              <TouchableOpacity accessibilityRole="button" onPress={() => update(split.id, { amount: money(amount + remaining) })} className="self-start mt-1.5 px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-900/20">
                <Text className="text-[11px] font-bold text-amber-700 dark:text-amber-300">+ Use remaining {formatCurrency(remaining)}</Text>
              </TouchableOpacity>
            )}

            <TextInput
              value={split.description || ''}
              onChangeText={value => update(split.id, { description: value })}
              placeholder="Description (optional)"
              placeholderTextColor="#94a3b8"
              className="bg-slate-50 dark:bg-slate-800 rounded-xl px-3 py-2.5 text-slate-900 dark:text-white mt-2 mb-2"
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
              suggestOnFocus
            />

            {/* Items sit inside their part: an accent rail rather than another card. */}
            {isItemized && (
              <View className="mt-3 pl-3 border-l-2 border-orange-300 dark:border-orange-700">
                <Text className="text-[10px] font-bold uppercase text-orange-600 dark:text-orange-400 mb-2">Items in this part</Text>
                <LineItemsEditor
                  lines={partLines(split.id)}
                  onChange={next => setPartLines(split.id, next)}
                  total={amount}
                  formatCurrency={formatCurrency}
                  showProject={false}
                  nested
                  onUseTotal={followsItems ? undefined : linesTotal => { setAuto(split.id, true); update(split.id, { amount: linesTotal }); }}
                />
              </View>
            )}
          </View>
        );
      })}
      {splits.length === 1 && <Text className="text-amber-600 text-[10px]">Add at least one more part, or remove this split.</Text>}
    </View>
  );
}

function OptionChip({ checked, icon, color, label, accessibilityLabel, onPress }: {
  checked: boolean; icon: React.ComponentProps<typeof FontAwesome>['name']; color: string; label: string; accessibilityLabel: string; onPress: () => void;
}) {
  return (
    <TouchableOpacity
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      className={`flex-row items-center px-3 py-1.5 rounded-full border ${checked ? '' : 'border-slate-200 dark:border-slate-700'}`}
      style={checked ? { borderColor: color, backgroundColor: `${color}1A` } : undefined}
    >
      <FontAwesome name={checked ? 'check-square' : 'square-o'} size={13} color={checked ? color : '#94a3b8'} />
      <FontAwesome name={icon} size={11} color={color} style={{ marginLeft: 6 }} />
      <Text className="ml-1.5 text-xs font-bold text-slate-700 dark:text-slate-200">{label}</Text>
    </TouchableOpacity>
  );
}
