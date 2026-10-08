import { FontAwesome } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { MAX_TAGS_PER_TRANSACTION, MAX_TAG_LENGTH, normalizeTransactionTags } from '@/utils/tags';

const SUGGESTION_LIMIT = 24;

export default function TagInputField({
  tags,
  suggestions = [],
  onChange,
  placeholder = 'Add a tag',
  savedLabel = 'Saved tags',
  compact = false,
}: {
  tags?: string[];
  suggestions?: string[];
  onChange: (tags: string[] | undefined) => void;
  placeholder?: string;
  savedLabel?: string;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const selected = tags || [];
  const atLimit = selected.length >= MAX_TAGS_PER_TRANSACTION;

  const selectedKeys = useMemo(
    () => new Set(selected.map(tag => tag.toLowerCase())),
    [selected],
  );

  // Saved tags the user has not already applied here, newest typing first.
  const available = useMemo(() => {
    const unique = new Map<string, string>();
    for (const tag of suggestions) {
      if (typeof tag !== 'string') continue;
      const trimmed = tag.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (selectedKeys.has(key) || unique.has(key)) continue;
      unique.set(key, trimmed);
    }
    // Preserve the caller's relevance order. New users still receive the
    // caller's alphabetical fallback.
    return [...unique.values()];
  }, [selectedKeys, suggestions]);

  const needle = draft.trim().toLowerCase();
  const matching = useMemo(() => {
    if (!needle) return available;
    return available
      .filter(tag => tag.toLowerCase().includes(needle))
      .sort((a, b) => {
        const aStarts = a.toLowerCase().startsWith(needle) ? 0 : 1;
        const bStarts = b.toLowerCase().startsWith(needle) ? 0 : 1;
        return aStarts - bStarts || a.localeCompare(b);
      });
  }, [available, needle]);

  const visible = matching.slice(0, SUGGESTION_LIMIT);
  const isNewTag = needle.length > 0 && !available.some(tag => tag.toLowerCase() === needle) && !selectedKeys.has(needle);

  const apply = (next: string[]) => onChange(normalizeTransactionTags(next));

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed || atLimit) return;
    if (selectedKeys.has(trimmed.toLowerCase())) {
      setDraft('');
      return;
    }
    apply([...selected, trimmed]);
    setDraft('');
  };

  const removeTag = (tag: string) => apply(selected.filter(item => item !== tag));

  // A comma or newline anywhere in the text means the user finished a tag.
  const handleChangeText = (value: string) => {
    if (!/[,\n]/.test(value)) {
      setDraft(value.slice(0, MAX_TAG_LENGTH));
      return;
    }
    const parts = value.split(/[,\n]/);
    const tail = parts.pop() ?? '';
    const next = [...selected];
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      if (next.some(item => item.toLowerCase() === trimmed.toLowerCase())) continue;
      next.push(trimmed);
    }
    apply(next);
    setDraft(tail.slice(0, MAX_TAG_LENGTH));
  };

  return (
    <View>
      {selected.length > 0 && (
        <View className="flex-row flex-wrap gap-2 mb-2">
          {selected.map(tag => (
            <TouchableOpacity
              key={tag}
              accessibilityRole="button"
              accessibilityLabel={`Remove tag ${tag}`}
              onPress={() => removeTag(tag)}
              className="flex-row items-center px-2.5 py-1.5 rounded-full bg-indigo-600"
            >
              <Text className="text-white text-[11px] font-semibold mr-1.5">#{tag}</Text>
              <FontAwesome name="times" size={9} color="#e0e7ff" />
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View className={`flex-row items-center rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 ${compact ? '' : 'py-0.5'}`}>
        <FontAwesome name="tag" size={11} color="#94a3b8" />
        <TextInput
          value={draft}
          onChangeText={handleChangeText}
          onSubmitEditing={() => addTag(draft)}
          editable={!atLimit}
          placeholder={atLimit ? `Tag limit reached (${MAX_TAGS_PER_TRANSACTION})` : placeholder}
          placeholderTextColor="#94a3b8"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          maxLength={MAX_TAG_LENGTH}
          className="flex-1 py-2.5 px-2 text-slate-900 dark:text-white text-xs"
        />
        {isNewTag && !atLimit && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`Add tag ${draft.trim()}`}
            onPress={() => addTag(draft)}
            className="px-2.5 py-1.5 rounded-lg bg-indigo-600 ml-1"
          >
            <Text className="text-white text-[10px] font-bold">Add</Text>
          </TouchableOpacity>
        )}
      </View>

      {!atLimit && visible.length > 0 && (
        <View className="mt-2">
          <Text className="text-[10px] text-slate-500 font-bold uppercase mb-1.5 dark:text-slate-400">
            {needle ? 'Matching tags' : savedLabel}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-1 px-1">
            {visible.map(tag => (
              <TouchableOpacity
                key={tag}
                accessibilityRole="button"
                accessibilityLabel={`Add tag ${tag}`}
                onPress={() => addTag(tag)}
                className="mr-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              >
                <Text className="text-slate-600 dark:text-slate-300 text-[11px] font-medium">#{tag}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {needle.length > 0 && visible.length === 0 && isNewTag && (
        <Text className="text-[10px] text-slate-500 mt-1.5 dark:text-slate-400">
          No saved tag matches — press Add to create #{draft.trim()}.
        </Text>
      )}
    </View>
  );
}
