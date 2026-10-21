import FormSheet from '@/components/FormSheet';
import { useAppSettings } from '@/contexts/AppSettingsContext';
import { formatCalendarDate } from '@/utils/ethiopianCalendar';
import {
  EMPTY_SMS_DRAFT_FILTERS,
  parseFilterAmount,
  type SmsDraftFilters,
  type SmsDraftTypeFilter,
} from '@/utils/smsDraftFilters';
import { FontAwesome } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import React, { useEffect, useState } from 'react';
import { Platform, Text, TextInput, TouchableOpacity, View } from 'react-native';

const startOfDay = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
const endOfDay = (ms: number) => { const d = new Date(ms); d.setHours(23, 59, 59, 999); return d.getTime(); };
const DAY = 24 * 60 * 60 * 1000;

const DATE_PRESETS: Array<{ label: string; range: () => [number, number] }> = [
  { label: 'Today', range: () => [startOfDay(Date.now()), endOfDay(Date.now())] },
  { label: 'Last 7 days', range: () => [startOfDay(Date.now() - 6 * DAY), endOfDay(Date.now())] },
  { label: 'Last 30 days', range: () => [startOfDay(Date.now() - 29 * DAY), endOfDay(Date.now())] },
  { label: 'This month', range: () => { const d = new Date(); return [new Date(d.getFullYear(), d.getMonth(), 1).getTime(), endOfDay(Date.now())]; } },
];
const TYPES: Array<{ value: SmsDraftTypeFilter; label: string }> = [
  { value: 'all', label: 'All' }, { value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }, { value: 'transfer', label: 'Transfer' },
];
const COLLAPSED_CHIPS = 8;

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`px-3 py-1.5 rounded-lg border ${selected ? 'bg-primary-500 border-primary-500' : 'border-slate-200 dark:border-slate-700'}`}
    >
      <Text numberOfLines={1} className={`text-xs ${selected ? 'text-white font-semibold' : 'text-slate-600 dark:text-slate-300'}`}>{label}</Text>
    </TouchableOpacity>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <Text className="text-slate-500 dark:text-slate-400 text-[10px] font-bold uppercase mb-2 mt-4">{children}</Text>;
}

const inputClass = 'rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2.5 text-slate-900 dark:text-white text-sm';

interface Props {
  visible: boolean;
  onClose: () => void;
  value: SmsDraftFilters;
  onApply: (filters: SmsDraftFilters) => void;
  /** Accounts that can be chosen; hidden when the screen is already scoped to one account. */
  accounts: Array<{ id: string; name: string }>;
  recipients: string[];
  categories: string[];
}

/** Bottom sheet for the SMS transactions screen's filters. Edits apply on "Show results". */
export default function SmsDraftFilterSheet({ visible, onClose, value, onApply, accounts, recipients, categories }: Props) {
  const { calendarSystem } = useAppSettings();
  const [draft, setDraft] = useState<SmsDraftFilters>(value);
  const [minText, setMinText] = useState('');
  const [maxText, setMaxText] = useState('');
  const [showAllRecipients, setShowAllRecipients] = useState(false);
  const [showAllCategories, setShowAllCategories] = useState(false);

  // Start each opening from the filters currently applied.
  useEffect(() => {
    if (!visible) return;
    setDraft(value);
    setMinText(value.amountMin === undefined ? '' : String(value.amountMin));
    setMaxText(value.amountMax === undefined ? '' : String(value.amountMax));
  }, [visible, value]);

  const update = (patch: Partial<SmsDraftFilters>) => setDraft(current => ({ ...current, ...patch }));
  const toggleIn = (list: string[], item: string) => list.includes(item) ? list.filter(entry => entry !== item) : [...list, item];
  const formatDay = (ms: number) => formatCalendarDate(ms, calendarSystem, { month: 'short', day: 'numeric', year: 'numeric' });

  const pickDate = (which: 'from' | 'to') => {
    const current = which === 'from' ? draft.dateFrom : draft.dateTo;
    DateTimePickerAndroid.open({
      value: new Date(current ?? Date.now()),
      mode: 'date',
      onChange: (event, date) => {
        if (event.type !== 'set' || !date) return;
        update(which === 'from' ? { dateFrom: startOfDay(date.getTime()) } : { dateTo: endOfDay(date.getTime()) });
      },
    });
  };

  const amountMin = parseFilterAmount(minText);
  const amountMax = parseFilterAmount(maxText);
  const amountInvalid = (!!minText.trim() && amountMin === undefined) || (!!maxText.trim() && amountMax === undefined)
    || (amountMin !== undefined && amountMax !== undefined && amountMin > amountMax);
  const dateInvalid = draft.dateFrom !== undefined && draft.dateTo !== undefined && draft.dateFrom > draft.dateTo;

  const apply = () => {
    if (amountInvalid || dateInvalid) return;
    onApply({ ...draft, search: draft.search.trim(), recipient: draft.recipient.trim(), amountMin, amountMax });
    onClose();
  };
  const reset = () => {
    setDraft(EMPTY_SMS_DRAFT_FILTERS);
    setMinText(''); setMaxText('');
  };

  const shownRecipients = showAllRecipients ? recipients : recipients.slice(0, COLLAPSED_CHIPS);
  const shownCategories = showAllCategories ? categories : categories.slice(0, COLLAPSED_CHIPS);

  return (
    <FormSheet visible={visible} onClose={onClose} accessibilityLabel="Filter SMS transactions" maxHeight="90%">
      <View className="px-5 pb-6">
        <View className="flex-row items-center justify-between mb-1">
          <Text className="text-slate-900 dark:text-white text-lg font-bold">Filter SMS transactions</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close filters" onPress={onClose} className="p-2">
            <FontAwesome name="times" size={18} color="#94a3b8" />
          </TouchableOpacity>
        </View>

        <SectionLabel>Search</SectionLabel>
        <TextInput
          value={draft.search}
          onChangeText={search => update({ search })}
          placeholder="Description, reference, SMS text…"
          placeholderTextColor="#94a3b8"
          autoCapitalize="none"
          className={inputClass}
        />

        <SectionLabel>Type</SectionLabel>
        <View className="flex-row flex-wrap gap-2">
          {TYPES.map(type => <Chip key={type.value} label={type.label} selected={draft.type === type.value} onPress={() => update({ type: type.value })} />)}
        </View>

        {accounts.length > 1 && <>
          <SectionLabel>Account</SectionLabel>
          <View className="flex-row flex-wrap gap-2">
            {accounts.map(account => <Chip key={account.id} label={account.name} selected={draft.accountIds.includes(account.id)} onPress={() => update({ accountIds: toggleIn(draft.accountIds, account.id) })} />)}
          </View>
        </>}

        <SectionLabel>Receiver / sender</SectionLabel>
        <TextInput
          value={draft.recipient}
          onChangeText={recipient => update({ recipient })}
          placeholder="Name or part of a name"
          placeholderTextColor="#94a3b8"
          className={inputClass}
        />
        {recipients.length > 0 && <View className="flex-row flex-wrap gap-2 mt-2">
          {shownRecipients.map(name => <Chip key={name} label={name} selected={draft.recipient.trim().toLocaleLowerCase() === name.toLocaleLowerCase()} onPress={() => update({ recipient: draft.recipient.trim().toLocaleLowerCase() === name.toLocaleLowerCase() ? '' : name })} />)}
          {recipients.length > COLLAPSED_CHIPS && <Chip label={showAllRecipients ? 'Show fewer' : `+${recipients.length - COLLAPSED_CHIPS} more`} selected={false} onPress={() => setShowAllRecipients(value => !value)} />}
        </View>}

        <SectionLabel>Date</SectionLabel>
        <View className="flex-row flex-wrap gap-2 mb-2">
          {DATE_PRESETS.map(preset => {
            const [from, to] = preset.range();
            const active = draft.dateFrom === from && draft.dateTo !== undefined && Math.abs(draft.dateTo - to) < DAY;
            return <Chip key={preset.label} label={preset.label} selected={active} onPress={() => update(active ? { dateFrom: undefined, dateTo: undefined } : { dateFrom: from, dateTo: to })} />;
          })}
        </View>
        <View className="flex-row gap-2">
          {(['from', 'to'] as const).map(which => {
            const current = which === 'from' ? draft.dateFrom : draft.dateTo;
            return (
              <View key={which} className="flex-1">
                <Text className="text-slate-500 dark:text-slate-400 text-[11px] mb-1">{which === 'from' ? 'From' : 'To'}</Text>
                {Platform.OS === 'android' ? (
                  <View className="flex-row items-center">
                    <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${which === 'from' ? 'Start' : 'End'} date`} onPress={() => pickDate(which)} className={`${inputClass} flex-1 flex-row items-center`}>
                      <FontAwesome name="calendar" size={12} color="#64748b" />
                      <Text className={`ml-2 text-sm ${current === undefined ? 'text-slate-500 dark:text-slate-400' : 'text-slate-900 dark:text-white'}`}>{current === undefined ? 'Any' : formatDay(current)}</Text>
                    </TouchableOpacity>
                    {current !== undefined && <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Clear ${which} date`} onPress={() => update(which === 'from' ? { dateFrom: undefined } : { dateTo: undefined })} className="p-2"><FontAwesome name="times-circle" size={14} color="#94a3b8" /></TouchableOpacity>}
                  </View>
                ) : (
                  <DateTimePicker
                    value={new Date(current ?? Date.now())}
                    mode="date"
                    display="compact"
                    onChange={(_, date) => { if (date) update(which === 'from' ? { dateFrom: startOfDay(date.getTime()) } : { dateTo: endOfDay(date.getTime()) }); }}
                  />
                )}
              </View>
            );
          })}
        </View>
        {dateInvalid && <Text className="text-red-500 text-[11px] mt-1">The start date is after the end date.</Text>}

        <SectionLabel>Amount</SectionLabel>
        <View className="flex-row gap-2 items-center">
          <TextInput value={minText} onChangeText={setMinText} placeholder="Min" placeholderTextColor="#94a3b8" keyboardType="decimal-pad" className={`${inputClass} flex-1`} accessibilityLabel="Minimum amount" />
          <Text className="text-slate-500 dark:text-slate-400">–</Text>
          <TextInput value={maxText} onChangeText={setMaxText} placeholder="Max" placeholderTextColor="#94a3b8" keyboardType="decimal-pad" className={`${inputClass} flex-1`} accessibilityLabel="Maximum amount" />
        </View>
        <Text className="text-slate-500 dark:text-slate-400 text-[11px] mt-1">Enter the same value in both for an exact amount.</Text>
        {amountInvalid && <Text className="text-red-500 text-[11px] mt-1">Enter valid amounts, with the minimum not above the maximum.</Text>}

        {categories.length > 0 && <>
          <SectionLabel>Category</SectionLabel>
          <View className="flex-row flex-wrap gap-2">
            {shownCategories.map(category => <Chip key={category} label={category} selected={draft.categories.includes(category)} onPress={() => update({ categories: toggleIn(draft.categories, category) })} />)}
            {categories.length > COLLAPSED_CHIPS && <Chip label={showAllCategories ? 'Show fewer' : `+${categories.length - COLLAPSED_CHIPS} more`} selected={false} onPress={() => setShowAllCategories(value => !value)} />}
          </View>
        </>}

        <View className="flex-row gap-3 mt-6">
          <TouchableOpacity accessibilityRole="button" onPress={reset} className="flex-1 py-3.5 rounded-2xl bg-slate-100 dark:bg-slate-800 items-center">
            <Text className="text-slate-600 dark:text-slate-300 font-bold">Clear all</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" onPress={apply} disabled={amountInvalid || dateInvalid} className={`flex-1 py-3.5 rounded-2xl items-center ${amountInvalid || dateInvalid ? 'bg-slate-300 dark:bg-slate-700' : 'bg-primary-500'}`}>
            <Text className="text-white font-bold">Show results</Text>
          </TouchableOpacity>
        </View>
      </View>
    </FormSheet>
  );
}
