import { FontAwesome } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import PersonPicker from '@/components/PersonPicker';
import type { RecipientProfile } from '@/services/RecipientIdentityService';

export default function PersonLinkField({ label = 'Person', person, suggestedName, disabled, onChange }: {
  label?: string;
  person?: RecipientProfile;
  suggestedName?: string;
  disabled?: boolean;
  onChange: (person?: RecipientProfile) => void;
}) {
  const [open, setOpen] = useState(false);
  return <View className="mb-4">
    <View className="flex-row items-center justify-between mb-2"><Text className="text-slate-700 dark:text-slate-300 text-sm font-bold">{label}</Text><Text className="text-slate-500 dark:text-slate-400 text-[10px]">Optional</Text></View>
    <TouchableOpacity disabled={disabled} onPress={() => setOpen(true)} className={`flex-row items-center rounded-2xl border px-3 py-3 ${person ? 'bg-teal-50 dark:bg-teal-950/40 border-teal-300 dark:border-teal-800' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'} ${disabled ? 'opacity-60' : ''}`}>
      <View className={`w-9 h-9 rounded-xl items-center justify-center mr-3 ${person ? 'bg-teal-600' : 'bg-slate-200 dark:bg-slate-700'}`}><FontAwesome name={person ? 'user' : 'user-plus'} size={14} color={person ? '#fff' : '#64748b'} /></View>
      <View className="flex-1"><Text className={`font-bold ${person ? 'text-teal-800 dark:text-teal-200' : 'text-slate-700 dark:text-slate-200'}`}>{person?.displayName || 'Choose or save a person'}</Text><Text className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{person ? (person.groups || []).join(' • ') || 'Saved person' : 'Links this record to their financial history'}</Text></View>
      <FontAwesome name="chevron-right" size={12} color="#94a3b8" />
    </TouchableOpacity>
    <PersonPicker visible={open} selectedId={person?.id} suggestedName={suggestedName} onClose={() => setOpen(false)} onSelect={onChange} />
  </View>;
}
