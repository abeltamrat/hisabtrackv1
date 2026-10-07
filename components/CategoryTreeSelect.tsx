import { FontAwesome } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

import CategoryIcon from '@/components/CategoryIcon';

export type TreeCategory = {
  id: string;
  name: string;
  parentId?: string;
  color?: string;
  icon?: string;
};

const PATH_SEPARATOR = ' › ';

/** Parent names from the root down to (but excluding) the category itself. */
export function categoryAncestors(categories: TreeCategory[], category: TreeCategory): string[] {
  const names: string[] = [];
  const seen = new Set<string>([category.id]);
  let current = categories.find(item => item.id === category.parentId);
  while (current && !seen.has(current.id)) {
    names.unshift(current.name);
    seen.add(current.id);
    current = categories.find(item => item.id === current!.parentId);
  }
  return names;
}

export default function CategoryTreeSelect({
  categories,
  value,
  onChange,
  placeholder = 'Choose a category',
  accessibilityLabel = 'Category',
  compact = false,
}: {
  categories: TreeCategory[];
  value?: string;
  onChange: (name: string) => void;
  placeholder?: string;
  accessibilityLabel?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const selected = useMemo(
    () => categories.find(category => category.name === value),
    [categories, value],
  );
  const selectedPath = selected ? categoryAncestors(categories, selected).join(PATH_SEPARATOR) : '';

  const childrenOf = (parentId: string | undefined) =>
    categories.filter(category => (category.parentId ?? undefined) === parentId);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return categories
      .filter(category => category.name.toLowerCase().includes(needle))
      .slice(0, 40);
  }, [categories, query]);

  const toggleCollapse = (id: string) => {
    setCollapsed(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const pick = (name: string) => {
    onChange(name);
    setQuery('');
    setOpen(false);
  };

  const renderBranch = (parentId: string | undefined, depth: number): React.ReactNode =>
    // Depth guard: a malformed parentId cycle would otherwise recurse forever.
    depth > 12 ? null : childrenOf(parentId).map(category => {
      const children = childrenOf(category.id);
      const isCollapsed = collapsed.has(category.id);
      const isSelected = category.name === value;

      return (
        <View key={category.id}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            onPress={() => pick(category.name)}
            style={{ marginLeft: Math.min(depth, 5) * 14 }}
            className={`flex-row items-center py-2 px-2.5 rounded-xl mb-1 border ${isSelected ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-500' : 'bg-slate-50 dark:bg-slate-900 border-transparent'}`}
          >
            {depth > 0 && <View className="w-0.5 h-3 bg-slate-300 dark:bg-slate-600 mr-2 rounded-full" />}
            <View
              className="rounded-xl justify-center items-center mr-2"
              style={{
                width: depth === 0 ? 28 : 24,
                height: depth === 0 ? 28 : 24,
                backgroundColor: (category.color || '#64748b') + '20',
              }}
            >
              <CategoryIcon icon={category.icon} size={depth === 0 ? 13 : 11} color={category.color} />
            </View>
            <Text
              className={`flex-1 text-slate-900 dark:text-white ${depth === 0 ? 'text-xs font-semibold' : 'text-[11px] font-medium'}`}
              numberOfLines={1}
            >
              {category.name}
            </Text>
            {children.length > 0 && (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`${isCollapsed ? 'Expand' : 'Collapse'} ${category.name}`}
                accessibilityState={{ expanded: !isCollapsed }}
                onPress={() => toggleCollapse(category.id)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                className="flex-row items-center px-1"
              >
                <Text className="text-slate-500 text-[10px] mr-1 dark:text-slate-400">{children.length}</Text>
                <FontAwesome name={isCollapsed ? 'chevron-right' : 'chevron-down'} size={8} color="#94a3b8" />
              </TouchableOpacity>
            )}
            {isSelected && <FontAwesome name="check" size={10} color="#6366f1" style={{ marginLeft: 4 }} />}
          </TouchableOpacity>
          {children.length > 0 && !isCollapsed && renderBranch(category.id, depth + 1)}
        </View>
      );
    });

  return (
    <View>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={value ? `${accessibilityLabel}: ${value}` : accessibilityLabel}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(previous => !previous)}
        className={`flex-row items-center rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 ${compact ? 'px-3 py-2.5' : 'px-3 py-3'}`}
      >
        <View
          className="rounded-xl justify-center items-center mr-2.5"
          style={{ width: 28, height: 28, backgroundColor: (selected?.color || '#64748b') + '20' }}
        >
          <CategoryIcon icon={selected?.icon} size={13} color={selected?.color} />
        </View>
        <View className="flex-1">
          {selectedPath ? (
            <Text className="text-slate-500 text-[10px] dark:text-slate-400" numberOfLines={1}>
              {selectedPath}
            </Text>
          ) : null}
          <Text
            className={`text-xs font-semibold ${value ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}
            numberOfLines={1}
          >
            {/* A value with no matching category still shows, since it is what gets saved. */}
            {selected?.name || value || placeholder}
          </Text>
        </View>
        <FontAwesome name={open ? 'chevron-up' : 'chevron-down'} size={10} color="#94a3b8" />
      </TouchableOpacity>

      {open && (
        <View className="mt-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2">
          <View className="flex-row items-center rounded-xl bg-slate-50 dark:bg-slate-800 px-3 mb-2">
            <FontAwesome name="search" size={11} color="#94a3b8" />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search categories"
              placeholderTextColor="#94a3b8"
              autoCapitalize="none"
              autoCorrect={false}
              className="flex-1 py-2.5 px-2 text-slate-900 dark:text-white text-xs"
            />
            {query.length > 0 && (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Clear category search"
                onPress={() => setQuery('')}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <FontAwesome name="times-circle" size={13} color="#94a3b8" />
              </TouchableOpacity>
            )}
          </View>

          <ScrollView showsVerticalScrollIndicator={false} className="max-h-56" nestedScrollEnabled>
            {query.trim().length > 0 ? (
              matches.length === 0 ? (
                <Text className="text-slate-500 text-xs py-3 text-center dark:text-slate-400">
                  No category matches that search.
                </Text>
              ) : (
                matches.map(category => {
                  const path = categoryAncestors(categories, category).join(PATH_SEPARATOR);
                  const isSelected = category.name === value;
                  return (
                    <TouchableOpacity
                      key={category.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      onPress={() => pick(category.name)}
                      className={`flex-row items-center py-2 px-2.5 rounded-xl mb-1 border ${isSelected ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-500' : 'bg-slate-50 dark:bg-slate-900 border-transparent'}`}
                    >
                      <View
                        className="rounded-xl justify-center items-center mr-2"
                        style={{ width: 26, height: 26, backgroundColor: (category.color || '#64748b') + '20' }}
                      >
                        <CategoryIcon icon={category.icon} size={12} color={category.color} />
                      </View>
                      <View className="flex-1">
                        {path ? (
                          <Text className="text-slate-500 text-[10px] dark:text-slate-400" numberOfLines={1}>
                            {path}
                          </Text>
                        ) : null}
                        <Text className="text-slate-900 dark:text-white text-xs font-semibold" numberOfLines={1}>
                          {category.name}
                        </Text>
                      </View>
                      {isSelected && <FontAwesome name="check" size={10} color="#6366f1" />}
                    </TouchableOpacity>
                  );
                })
              )
            ) : categories.length === 0 ? (
              <Text className="text-slate-500 text-xs py-3 text-center dark:text-slate-400">
                No categories yet.
              </Text>
            ) : (
              renderBranch(undefined, 0)
            )}
          </ScrollView>
        </View>
      )}
    </View>
  );
}
