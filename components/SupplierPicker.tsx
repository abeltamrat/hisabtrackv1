import FormSheet from '@/components/FormSheet';
import { useMelaProjects } from '@/components/ProjectPicker';
import { supplierLink } from '@/services/MelaService';
import type { SupplierLink } from '@/types/database';
import { FontAwesome } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Text, TextInput, TouchableOpacity, View } from 'react-native';

/**
 * Mela supplier for a purchase. Shown only when Mela is connected and the
 * user's role can see suppliers; otherwise the purchase uses the normal
 * recipient / People field.
 */
export function SupplierField({ value, onChange }: { value?: SupplierLink; onChange: (supplier: SupplierLink | undefined) => void }) {
  const { connected, suppliers } = useMelaProjects();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? suppliers.filter(s => `${s.name} ${s.store || ''}`.toLowerCase().includes(q)) : suppliers;
  }, [query, suppliers]);
  useEffect(() => { if (!open) setQuery(''); }, [open]);

  if (!value && (!connected || suppliers.length === 0)) return null;
  return (
    <>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={value ? `Supplier ${value.name}` : 'Choose supplier'} onPress={() => setOpen(true)}
        className="flex-row items-center rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3">
        <FontAwesome name="truck" size={14} color="#f97316" />
        <View className="flex-1 ml-3">
          <Text className="text-[10px] font-bold text-slate-500 dark:text-slate-400">SUPPLIER (MELA)</Text>
          <Text numberOfLines={1} className={`text-sm font-bold ${value ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>{value ? value.name : 'No supplier'}</Text>
        </View>
        {value
          ? <TouchableOpacity accessibilityLabel="Clear supplier" onPress={() => onChange(undefined)} className="p-1"><FontAwesome name="times-circle" size={16} color="#94a3b8" /></TouchableOpacity>
          : <FontAwesome name="chevron-right" size={11} color="#94a3b8" />}
      </TouchableOpacity>
      <FormSheet visible={open} onClose={() => setOpen(false)} scrollable={false} accessibilityLabel="Choose supplier">
        <Text className="text-lg font-extrabold text-slate-900 dark:text-white mb-3">Choose supplier</Text>
        <View className="flex-row items-center bg-slate-100 dark:bg-slate-800 rounded-2xl px-4 mb-3">
          <FontAwesome name="search" size={14} color="#94a3b8" />
          <TextInput value={query} onChangeText={setQuery} placeholder="Search suppliers" placeholderTextColor="#94a3b8" autoCorrect={false} className="flex-1 px-3 py-3 text-slate-900 dark:text-white" />
        </View>
        <FlatList
          style={{ height: 380 }}
          data={visible}
          keyExtractor={s => String(s.id)}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <TouchableOpacity onPress={() => { onChange(supplierLink(item)); setOpen(false); }} className={`p-3 rounded-2xl mb-2 border ${value?.id === item.id ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/30' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'}`}>
              <Text numberOfLines={1} className="text-sm font-extrabold text-slate-900 dark:text-white">{item.name}</Text>
              {item.store && <Text numberOfLines={1} className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{item.store}</Text>}
            </TouchableOpacity>
          )}
          ListEmptyComponent={<Text className="text-center text-sm text-slate-500 dark:text-slate-400 py-10">No supplier matches your search.</Text>}
        />
      </FormSheet>
    </>
  );
}

export default SupplierField;
