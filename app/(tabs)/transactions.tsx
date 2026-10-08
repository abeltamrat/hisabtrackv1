import CoinLoader from '@/components/CoinLoader';
import { BUNDLED_LOGOS } from '@/assets/bankLogos/et';
import CategoryIcon from '@/components/CategoryIcon';
import { useTransactions } from '@/context/TransactionContext';
import { useAppSettings } from '@/contexts/AppSettingsContext';
import { useI18n } from '@/contexts/I18nContext';
import { useTheme } from '@/contexts/ThemeContext';
import { AppDispatch, RootState } from '@/store';
import { fetchTransactions } from '@/store/slices/transactionsSlice';
import ExportService from '@/services/ExportService';
import { hasTag } from '@/utils/tags';
import { operatingExpense, operatingIncome, sumMoney } from '@/utils/finance';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from '@/components/aurora/AuroraGradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Image, InteractionManager, Modal, Platform, ScrollView, SectionList, Text, TextInput, TouchableOpacity, View, useColorScheme } from 'react-native';
import { Alert } from '@/utils/alert';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';

import { useDispatch, useSelector } from 'react-redux';
import { themeTokens } from '@/constants/theme';
import { formatCalendarDate } from '@/utils/ethiopianCalendar';

const BUNDLED_LOGO_MAP = new Map(BUNDLED_LOGOS.map(b => [b.url, b]));

function getAccountImageSource(logoUrl: string | null | undefined) {
  if (!logoUrl) return undefined;
  const bundled = BUNDLED_LOGO_MAP.get(logoUrl);
  if (bundled?.src) {
    if (typeof bundled.src === 'number') return bundled.src;
    if (typeof bundled.src === 'string') return { uri: bundled.src };
    const src = bundled.src as { uri?: string; default?: string };
    if (src.uri) return bundled.src;
    if (src.default) return { uri: src.default };
    return bundled.src;
  }
  return { uri: logoUrl };
}

const SpinnerPickerSheet = ({
  show, value, mode, label, onClose, onConfirm,
}: {
  show: boolean; value: Date; mode: 'date' | 'time'; label: string;
  onClose: () => void; onConfirm: (d: Date) => void;
}) => {
  const pendingRef = React.useRef<Date>(value);
  const isDark = useColorScheme() === 'dark';
  const theme = themeTokens(isDark);
  React.useEffect(() => { if (show) pendingRef.current = value; }, [show]);
  if (!show) return null;
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
        <TouchableOpacity style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} activeOpacity={1} onPress={onClose} />
        <View style={{ backgroundColor: theme.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.border }}>
            <TouchableOpacity onPress={onClose}>
              <Text style={{ color: '#94a3b8', fontSize: 16 }}>Cancel</Text>
            </TouchableOpacity>
            <Text style={{ color: theme.text, fontWeight: '700', fontSize: 16 }}>{label}</Text>
            <TouchableOpacity onPress={() => { onClose(); onConfirm(pendingRef.current); }}>
              <Text style={{ color: '#6366f1', fontWeight: '700', fontSize: 16 }}>Done</Text>
            </TouchableOpacity>
          </View>
          <DateTimePicker
            value={value}
            mode={mode}
            display="spinner"
            style={{ height: 200, alignSelf: 'center', width: '100%' }}
            onChange={(_, d) => { if (d) pendingRef.current = d; }}
          />
        </View>
      </View>
    </Modal>
  );
};

export default function TransactionsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { type, tag, evidenceIds } = params as { type?: string; tag?: string; evidenceIds?: string };
  const dispatch = useDispatch<AppDispatch>();
  const { items: transactions, loading } = useSelector((state: RootState) => state.transactions);
  const accounts = useSelector((state: RootState) => state.accounts.items);
  const { categories } = useTransactions();
  const { t } = useI18n();
  const { formatCurrency, fontSize, calendarSystem } = useAppSettings();
  const { actualTheme } = useTheme();
  const isDark = actualTheme === 'dark';
  const theme = themeTokens(isDark);
  const isVerySmall = fontSize === 'V.Small';
  const headerTitleSize = fontSize === 'V.Small' ? 'text-lg' : fontSize === 'Small' ? 'text-xl' : fontSize === 'Large' ? 'text-3xl' : 'text-2xl';
  const labelSize = fontSize === 'V.Small' ? 'text-[11px]' : fontSize === 'Small' ? 'text-xs' : fontSize === 'Large' ? 'text-base' : 'text-sm';
  const denseButtonPadding = isVerySmall ? 'py-1.5' : 'py-2';
  const summaryValueSize = fontSize === 'V.Small' ? 'text-base' : 'text-lg';
  const [filter, setFilter] = useState<'ALL' | 'INCOME' | 'EXPENSE'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
  const [filterAccountIds, setFilterAccountIds] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState<Date | null>(null);
  const [dateTo, setDateTo] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState<'from' | 'to' | null>(null);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showTagModal, setShowTagModal] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showDateModal, setShowDateModal] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Organize categories hierarchically
  const filteredCategories = categories.filter(c => filter === 'ALL' || c.type === filter.toLowerCase());
  const rootCategories = filteredCategories.filter(c => !c.parentId);
  const getChildCategories = (parentId: string) => filteredCategories.filter(c => c.parentId === parentId);

  // Get all category names that should be included when a category is selected
  const getCategoryNamesToInclude = (selectedCatNames: string[]) => {
    if (selectedCatNames.length === 0) return null;
    const names = new Set<string>();
    for (const selectedCatName of selectedCatNames) {
      const selectedCat = categories.find(c => c.name === selectedCatName);
      if (!selectedCat) { names.add(selectedCatName); continue; }
      names.add(selectedCat.name);
      if (!selectedCat.parentId) {
        getChildCategories(selectedCat.id).forEach(c => names.add(c.name));
      }
    }
    return [...names];
  };

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      dispatch(fetchTransactions());
    });
    return () => task.cancel();
  }, [dispatch]);

  useEffect(() => {
    if (type && (type === 'INCOME' || type === 'EXPENSE')) {
      setFilter(type);
    }
  }, [type]);

  useEffect(() => {
    if (typeof tag === 'string' && tag.trim()) {
      setSelectedTags([tag.trim()]);
    }
  }, [tag]);

  const allTags = useMemo(() => {
    const tags = new Map<string, string>();
    transactions.forEach((transaction) => {
      (transaction.tags || []).forEach((transactionTag) => {
        const normalized = transactionTag.trim();
        if (!normalized) return;
        const key = normalized.toLowerCase();
        if (!tags.has(key)) {
          tags.set(key, normalized);
        }
      });
    });
    return [...tags.values()].sort((a, b) => a.localeCompare(b));
  }, [transactions]);

  const filteredTransactions = useMemo(() => {
    const categoriesToInclude = getCategoryNamesToInclude(selectedCategories);
    const evidence = typeof evidenceIds === 'string' && evidenceIds ? new Set(evidenceIds.split(',')) : null;

    return transactions.filter((t) => {
      if (evidence && !evidence.has(t.id)) return false;
      // Type filter
      if (filter !== 'ALL' && t.type !== filter) return false;

      // Category filter
      if (categoriesToInclude && !categoriesToInclude.includes(t.category)) return false;

      // Tag filter
      if (selectedTags.length > 0 && !selectedTags.some(st => hasTag(t.tags, st))) return false;

      // Account filter (applies to both card and table views)
      if (filterAccountIds.length > 0 && !filterAccountIds.includes(t.account_id) && !filterAccountIds.includes(t.to_account_id ?? '')) return false;

      // Date filter (applies to both card and table views)
      if (dateFrom && t.date < new Date(dateFrom).setHours(0, 0, 0, 0)) return false;
      if (dateTo && t.date > new Date(dateTo).setHours(23, 59, 59, 999)) return false;

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const tagMatches = (t.tags || []).some((transactionTag) => transactionTag.toLowerCase().includes(query));
        return (
          (t.description?.toLowerCase().includes(query) ?? false) ||
          (t.category?.toLowerCase().includes(query) ?? false) ||
          tagMatches
        );
      }

      return true;
    });
  }, [transactions, filter, selectedCategories, selectedTags, searchQuery, categories, filterAccountIds, dateFrom, dateTo, evidenceIds]);

  // Group by date
  const groupedTransactions = useMemo(() => {
    const groups: { [key: string]: typeof transactions } = {};

    filteredTransactions.forEach(transaction => {
      const date = new Date(transaction.date);
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      let dateKey: string;
      if (date.toDateString() === today.toDateString()) {
        dateKey = 'Today';
      } else if (date.toDateString() === yesterday.toDateString()) {
        dateKey = 'Yesterday';
      } else {
        dateKey = formatCalendarDate(date, calendarSystem, { month: 'short', day: 'numeric', year: 'numeric' });
      }

      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(transaction);
    });

    return Object.entries(groups).map(([date, items]) => ({ title: date, data: items }));
  }, [filteredTransactions, calendarSystem]);

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  const totals = useMemo(() => {
    const income = sumMoney(filteredTransactions.map(operatingIncome));
    const expense = sumMoney(filteredTransactions.map(operatingExpense));
    return { income, expense };
  }, [filteredTransactions]);

  const categoriesMap = useMemo(() => new Map(categories.map(c => [c.name, c])), [categories]);
  const accountsMap = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts]);

  // Running balance per transaction (account-aware)
  const transactionBalances = useMemo(() => {
    const baseBalance = filterAccountIds.length > 0
      ? accounts.filter(a => filterAccountIds.includes(a.id)).reduce((sum, a) => sum + (a.balance ?? 0), 0)
      : accounts.reduce((sum, a) => sum + (a.balance ?? 0), 0);
    const sorted = [...transactions].sort((a, b) => a.date - b.date);
    const getTxDelta = (t: typeof sorted[number]) => {
      if (filterAccountIds.length === 0) {
        if (t.type === 'INCOME') return t.amount;
        if (t.type === 'EXPENSE') return -t.amount;
        return 0;
      }
      if (t.type === 'INCOME' && filterAccountIds.includes(t.account_id)) return t.amount;
      if (t.type === 'EXPENSE' && filterAccountIds.includes(t.account_id)) return -t.amount;
      if (t.type === 'TRANSFER') {
        if (filterAccountIds.includes(t.account_id)) return -t.amount;
        // Destination receives the net of sender-side fees/VAT.
        if (filterAccountIds.includes(t.to_account_id ?? '')) return t.amount - (t.fees ?? 0) - (t.tax ?? 0);
      }
      return 0;
    };
    const totalNet = sorted.reduce((sum, t) => sum + getTxDelta(t), 0);
    let running = baseBalance - totalNet;
    const map = new Map<string, number>();
    for (const t of sorted) {
      running += getTxDelta(t);
      map.set(t.id, running);
    }
    return map;
  }, [transactions, accounts, filterAccountIds]);

  // Table view: oldest first (bank statement order)
  const tableTransactions = useMemo(
    () => [...filteredTransactions].sort((a, b) => a.date - b.date),
    [filteredTransactions]
  );

  // tableTransactions is already filtered by account/date via filteredTransactions

  const handleExport = async (format: 'pdf' | 'excel') => {
    setShowExportMenu(false);
    setExporting(true);
    try {
      await ExportService.exportReport({
        data: tableTransactions,
        accounts,
        title: 'Transaction Statement',
        type: 'transactions',
        format,
        calendarSystem,
        timeRange: dateFrom || dateTo
          ? `${dateFrom ? dateFrom.toLocaleDateString() : '–'} to ${dateTo ? dateTo.toLocaleDateString() : '–'}`
          : 'All Time',
        summary: { income: totals.income, expense: totals.expense, balance: totals.income - totals.expense },
      });
    } catch (e: any) {
      Alert.alert('Export failed', e?.message ?? String(e));
    } finally {
      setExporting(false);
    }
  };

  const formatTableDate = (ts: number) => {
    return formatCalendarDate(ts, calendarSystem, { month: 'short', day: 'numeric' });
  };

  return (
    <View className="flex-1 bg-slate-50 dark:bg-background-dark">

      {/* Header */}
      <View className="px-6 pt-4 pb-2">
        <View className="flex-row justify-between items-center mb-6">
          <Text className={`text-slate-900 dark:text-white ${headerTitleSize} font-bold`}>{t('transactions')}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Card view"
              accessibilityState={{ selected: viewMode === 'card' }}
              onPress={() => setViewMode('card')}
              style={{
                width: isVerySmall ? 36 : 40, height: isVerySmall ? 36 : 40,
                borderRadius: 12, justifyContent: 'center', alignItems: 'center',
                backgroundColor: viewMode === 'card' ? '#6366f1' : (theme.surface),
                borderWidth: 1,
                borderColor: viewMode === 'card' ? '#6366f1' : (theme.border),
                elevation: 1,
              }}
            >
              <FontAwesome name="th-large" size={isVerySmall ? 14 : 16} color={viewMode === 'card' ? '#ffffff' : '#64748b'} />
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Table view"
              accessibilityState={{ selected: viewMode === 'table' }}
              onPress={() => setViewMode('table')}
              style={{
                width: isVerySmall ? 36 : 40, height: isVerySmall ? 36 : 40,
                borderRadius: 12, justifyContent: 'center', alignItems: 'center',
                backgroundColor: viewMode === 'table' ? '#6366f1' : (theme.surface),
                borderWidth: 1,
                borderColor: viewMode === 'table' ? '#6366f1' : (theme.border),
                elevation: 1,
              }}
            >
              <FontAwesome name="table" size={isVerySmall ? 14 : 16} color={viewMode === 'table' ? '#ffffff' : '#64748b'} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Search Bar */}
        <View className={`flex-row items-center bg-white dark:bg-slate-800 rounded-2xl px-4 h-9 mb-2 shadow-sm border border-slate-100 dark:border-slate-700`}>
          <FontAwesome name="search" size={isVerySmall ? 14 : 16} color="#94a3b8" />
          <TextInput
            className={`flex-1 text-slate-900 dark:text-white ${isVerySmall ? 'text-sm' : 'text-base'} ml-3`}
            placeholder={t('searchTransactions')}
            placeholderTextColor="#94a3b8"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close" onPress={() => setSearchQuery('')}>
              <FontAwesome name="times-circle" size={16} color="#94a3b8" />
            </TouchableOpacity>
          )}
        </View>

        {/* Type Filters */}
        <View className="flex-row mb-2 bg-white dark:bg-slate-800 p-1 rounded-xl border border-slate-100 dark:border-slate-700">
          {(['ALL', 'INCOME', 'EXPENSE'] as const).map((f) => (
            <TouchableOpacity
              key={f}
              onPress={() => setFilter(f)}
              className="flex-1 rounded-xl"
              style={filter === f ? { elevation: 2 } : {}}
            >
              {filter === f ? (
                <LinearGradient
                  colors={['#4f46e5', '#4338ca']}
                  className={`${denseButtonPadding} rounded-xl items-center w-full`}
                >
                  <Text className={`${labelSize} font-bold capitalize text-white`}>
                    {f.toLowerCase()}
                  </Text>
                </LinearGradient>
              ) : (
                <View className={`${denseButtonPadding} items-center w-full`}>
                  <Text className={`${labelSize} font-bold capitalize text-slate-500 dark:text-slate-400`}>
                    {f.toLowerCase()}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>

        {/* Filter Buttons Row */}
        <View className="flex-row mb-1" style={{ gap: 6 }}>
          {/* Category */}
          <TouchableOpacity
            onPress={() => setShowCategoryModal(true)}
            style={{
              flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
              paddingVertical: 7, paddingHorizontal: 6, borderRadius: 10,
              backgroundColor: selectedCategories.length > 0 ? '#6366f1' : (theme.surface),
              borderWidth: 1, borderColor: selectedCategories.length > 0 ? '#6366f1' : (theme.border),
              elevation: 1,
            }}
          >
            <FontAwesome name="tag" size={11} color={selectedCategories.length > 0 ? '#fff' : '#94a3b8'} />
            <Text style={{ fontSize: 11, fontWeight: '700', marginLeft: 4, color: selectedCategories.length > 0 ? '#fff' : (theme.textMuted) }} numberOfLines={1}>
              {selectedCategories.length > 1 ? `${selectedCategories.length} Categories` : 'Category'}
            </Text>
            {selectedCategories.length > 0 && <FontAwesome name="times-circle" size={11} color="#fff" style={{ marginLeft: 4 }} />}
          </TouchableOpacity>

          {/* Tags */}
          <TouchableOpacity
            onPress={() => setShowTagModal(true)}
            style={{
              flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
              paddingVertical: 7, paddingHorizontal: 6, borderRadius: 10,
              backgroundColor: selectedTags.length > 0 ? '#6366f1' : (theme.surface),
              borderWidth: 1, borderColor: selectedTags.length > 0 ? '#6366f1' : (theme.border),
              elevation: 1,
            }}
          >
            <FontAwesome name="hashtag" size={11} color={selectedTags.length > 0 ? '#fff' : '#94a3b8'} />
            <Text style={{ fontSize: 11, fontWeight: '700', marginLeft: 4, color: selectedTags.length > 0 ? '#fff' : (theme.textMuted) }} numberOfLines={1}>
              {selectedTags.length > 1 ? `${selectedTags.length} Tags` : 'Tags'}
            </Text>
            {selectedTags.length > 0 && <FontAwesome name="times-circle" size={11} color="#fff" style={{ marginLeft: 4 }} />}
          </TouchableOpacity>

          {/* Accounts */}
          <TouchableOpacity
            onPress={() => setShowAccountModal(true)}
            style={{
              flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
              paddingVertical: 7, paddingHorizontal: 6, borderRadius: 10,
              backgroundColor: filterAccountIds.length > 0 ? '#6366f1' : (theme.surface),
              borderWidth: 1, borderColor: filterAccountIds.length > 0 ? '#6366f1' : (theme.border),
              elevation: 1,
            }}
          >
            <FontAwesome name="bank" size={11} color={filterAccountIds.length > 0 ? '#fff' : '#94a3b8'} />
            <Text style={{ fontSize: 11, fontWeight: '700', marginLeft: 4, color: filterAccountIds.length > 0 ? '#fff' : (theme.textMuted) }} numberOfLines={1}>
              {filterAccountIds.length > 1 ? `${filterAccountIds.length} Accounts` : 'Account'}
            </Text>
            {filterAccountIds.length > 0 && <FontAwesome name="times-circle" size={11} color="#fff" style={{ marginLeft: 4 }} />}
          </TouchableOpacity>

          {/* Date */}
          <TouchableOpacity
            onPress={() => setShowDateModal(true)}
            style={{
              flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
              paddingVertical: 7, paddingHorizontal: 6, borderRadius: 10,
              backgroundColor: (dateFrom || dateTo) ? '#6366f1' : (theme.surface),
              borderWidth: 1, borderColor: (dateFrom || dateTo) ? '#6366f1' : (theme.border),
              elevation: 1,
            }}
          >
            <FontAwesome name="calendar" size={11} color={(dateFrom || dateTo) ? '#fff' : '#94a3b8'} />
            <Text style={{ fontSize: 11, fontWeight: '700', marginLeft: 4, color: (dateFrom || dateTo) ? '#fff' : (theme.textMuted) }} numberOfLines={1}>Date</Text>
            {(dateFrom || dateTo) && <FontAwesome name="times-circle" size={11} color="#fff" style={{ marginLeft: 4 }} />}
          </TouchableOpacity>
        </View>

        {/* Active filter pills */}
        {(selectedCategories.length > 0 || selectedTags.length > 0 || filterAccountIds.length > 0 || dateFrom || dateTo) && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-2" style={{ marginHorizontal: -2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 2, paddingVertical: 4 }}>
              {selectedCategories.map(cat => (
                <TouchableOpacity
                  key={cat}
                  onPress={() => setSelectedCategories(prev => prev.filter(c => c !== cat))}
                  style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: isDark ? '#312e81' : '#eef2ff', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, marginRight: 6, borderWidth: 1, borderColor: '#6366f1' }}
                >
                  <FontAwesome name="tag" size={10} color="#6366f1" style={{ marginRight: 4 }} />
                  <Text style={{ fontSize: 11, color: '#6366f1', fontWeight: '700' }}>{cat}</Text>
                  <FontAwesome name="times" size={9} color="#6366f1" style={{ marginLeft: 6 }} />
                </TouchableOpacity>
              ))}
              {selectedTags.map(tag => (
                <TouchableOpacity
                  key={tag}
                  onPress={() => setSelectedTags(prev => prev.filter(t => t !== tag))}
                  style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: isDark ? '#312e81' : '#eef2ff', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, marginRight: 6, borderWidth: 1, borderColor: '#6366f1' }}
                >
                  <FontAwesome name="hashtag" size={10} color="#6366f1" style={{ marginRight: 4 }} />
                  <Text style={{ fontSize: 11, color: '#6366f1', fontWeight: '700' }}>#{tag}</Text>
                  <FontAwesome name="times" size={9} color="#6366f1" style={{ marginLeft: 6 }} />
                </TouchableOpacity>
              ))}
              {filterAccountIds.map(id => (
                <TouchableOpacity
                  key={id}
                  onPress={() => setFilterAccountIds(prev => prev.filter(a => a !== id))}
                  style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: isDark ? '#312e81' : '#eef2ff', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, marginRight: 6, borderWidth: 1, borderColor: '#6366f1' }}
                >
                  <FontAwesome name="bank" size={10} color="#6366f1" style={{ marginRight: 4 }} />
                  <Text style={{ fontSize: 11, color: '#6366f1', fontWeight: '700' }}>{accounts.find(a => a.id === id)?.name ?? 'Account'}</Text>
                  <FontAwesome name="times" size={9} color="#6366f1" style={{ marginLeft: 6 }} />
                </TouchableOpacity>
              ))}
              {(dateFrom || dateTo) && (
                <TouchableOpacity
                  onPress={() => { setDateFrom(null); setDateTo(null); }}
                  style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: isDark ? '#312e81' : '#eef2ff', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, marginRight: 6, borderWidth: 1, borderColor: '#6366f1' }}
                >
                  <FontAwesome name="calendar" size={10} color="#6366f1" style={{ marginRight: 4 }} />
                  <Text style={{ fontSize: 11, color: '#6366f1', fontWeight: '700' }}>
                    {dateFrom ? dateFrom.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '…'}
                    {' → '}
                    {dateTo ? dateTo.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '…'}
                  </Text>
                  <FontAwesome name="times" size={9} color="#6366f1" style={{ marginLeft: 6 }} />
                </TouchableOpacity>
              )}
            </View>
          </ScrollView>
        )}

        {/* Summary */}
        <View className="flex-row bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 overflow-hidden">
          <View className="flex-1 items-center py-2">
            <Text className="text-slate-500 dark:text-slate-400 text-[10px] font-semibold uppercase mb-0.5">{t('income')}</Text>
            <Text className="text-green-600 text-xs font-bold" numberOfLines={1}>{formatCurrency(totals.income)}</Text>
          </View>
          <View className="w-px bg-slate-100 dark:bg-slate-700" />
          <View className="flex-1 items-center py-2">
            <Text className="text-slate-500 dark:text-slate-400 text-[10px] font-semibold uppercase mb-0.5">{t('expense')}</Text>
            <Text className="text-red-500 text-xs font-bold" numberOfLines={1}>{formatCurrency(totals.expense)}</Text>
          </View>
          <View className="w-px bg-slate-100 dark:bg-slate-700" />
          <View className="flex-1 items-center py-2">
            <Text className="text-slate-500 dark:text-slate-400 text-[10px] font-semibold uppercase mb-0.5">{t('total')}</Text>
            <Text className="text-slate-900 dark:text-white text-xs font-bold" numberOfLines={1}>{formatCurrency(totals.income - totals.expense)}</Text>
          </View>
        </View>
      </View>

      {viewMode === 'card' ? (
        /* ── Card view (existing) ── */
        <SectionList
          sections={groupedTransactions}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24 }}
          showsVerticalScrollIndicator={false}
          maxToRenderPerBatch={10}
          windowSize={10}
          initialNumToRender={10}
          removeClippedSubviews={true}
          renderSectionHeader={({ section: { title } }) => (
            <Text className="text-slate-500 dark:text-slate-400 text-sm font-bold mb-3 mt-2">{title}</Text>
          )}
          renderItem={({ item }) => {
            const category = categoriesMap.get(item.category);
            const isIncome = item.type === 'INCOME';

            return (
              <TouchableOpacity
                key={item.id}
                onPress={() => router.push(`/transaction/${item.id}`)}
                className={`flex-row items-center bg-white dark:bg-slate-800 ${isVerySmall ? 'p-3.5' : 'p-4'} rounded-2xl mb-3 shadow-sm border border-slate-100 dark:border-slate-700`}
                style={{ elevation: 1 }}
              >
                <View className="relative">
                  <View
                    className="w-14 h-14 rounded-2xl justify-center items-center mr-4"
                    style={{ backgroundColor: category?.color ? category.color + '20' : (isIncome ? '#dcfce7' : '#fee2e2') }}
                  >
                    <CategoryIcon
                      icon={category?.icon ?? 'question'}
                      size={20}
                      color={category?.color || (isIncome ? '#16a34a' : '#ef4444')}
                    />
                  </View>
                  {(() => {
                    const account = accountsMap.get(item.account_id);
                    if (account?.logo) {
                      return (
                        <View className="absolute -bottom-2 -left-2 w-9 h-9 bg-slate-100 dark:bg-slate-700 rounded-full justify-center items-center shadow-sm border border-white dark:border-slate-800 z-10 overflow-hidden">
                          <FontAwesome name="bank" size={12} color="#94a3b8" style={{ position: 'absolute' }} />
                          <Image
                            source={getAccountImageSource(account.logo) as any}
                            className="w-full h-full"
                            resizeMode="cover"
                          />
                        </View>
                      );
                    }
                    return null;
                  })()}
                </View>
                <View className="flex-1">
                  <Text className="text-slate-900 dark:text-white font-bold text-base mb-1">{item.description}</Text>
                  <View className="flex-row items-center">
                    <Text className="text-slate-500 text-xs dark:text-slate-400">{item.category}</Text>
                    <View className="w-1 h-1 bg-slate-300 rounded-full mx-2" />
                    <Text className="text-slate-500 text-xs dark:text-slate-400">{formatTime(item.date)}</Text>
                  </View>
                  {item.tags && item.tags.length > 0 && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-2 -mx-0.5 px-0.5">
                      {item.tags.slice(0, 4).map((transactionTag) => (
                        <TouchableOpacity
                          key={`${item.id}-${transactionTag}`}
                          onPress={() => setSelectedTags(prev => prev.includes(transactionTag) ? prev.filter(t => t !== transactionTag) : [...prev, transactionTag])}
                          className="mr-2 px-2.5 py-1 rounded-full bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800"
                        >
                          <Text className="text-[10px] text-indigo-700 dark:text-indigo-300 font-semibold">#{transactionTag}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  )}
                </View>
                <View className="items-end">
                  <Text className={`font-bold ${summaryValueSize} ${isIncome ? 'text-green-600' : 'text-red-500'}`}>
                    {isIncome ? '+' : '-'}{formatCurrency(item.amount)}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View className="items-center justify-center mt-20">
              <View className="w-20 h-20 bg-slate-100 dark:bg-slate-800 rounded-full justify-center items-center mb-4">
                <FontAwesome name="search" size={32} color="#cbd5e1" />
              </View>
              <Text className="text-slate-900 dark:text-white font-bold text-lg mb-2">{t('noTransactionsFound')}</Text>
              <Text className="text-slate-500 text-sm text-center dark:text-slate-400">
                {searchQuery ? t('tryAdjustingSearch') : t('startAddingTransactions')}
              </Text>
            </View>
          }
        />
      ) : (
        /* ── Bank Statement Table view ── */
        <View style={{ flex: 1 }}>
          {/* Export button bar */}
          <View style={{ paddingHorizontal: 12, paddingVertical: 6, flexDirection: 'row', justifyContent: 'flex-end', borderBottomWidth: 1, borderBottomColor: isDark ? '#1e293b' : '#e2e8f0', backgroundColor: theme.background }}>
            <TouchableOpacity
              onPress={() => setShowExportMenu(true)}
              disabled={exporting}
              style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: '#6366f1' }}
            >
              {exporting
                ? <CoinLoader size="small" color="#fff" />
                : <FontAwesome name="download" size={11} color="#fff" />
              }
              <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700', marginLeft: 5 }}>Export</Text>
            </TouchableOpacity>
          </View>

          {/* Scrollable table */}
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 80 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={true} bounces={false}>
              <View>
                {/* Table header */}
                <View style={{
                  flexDirection: 'row',
                  backgroundColor: isDark ? '#312e81' : '#6366f1',
                  paddingVertical: 10,
                  paddingHorizontal: 6,
                }}>
                  {[
                    { label: 'Date',        w: 62 },
                    { label: 'Description', w: 130 },
                    { label: 'Category',    w: 80 },
                    { label: 'Tag',         w: 68 },
                    { label: 'Debit',       w: 80, right: true },
                    { label: 'Credit',      w: 80, right: true },
                    { label: 'Balance',     w: 90, right: true },
                  ].map(col => (
                    <Text
                      key={col.label}
                      style={{
                        width: col.w,
                        color: '#e0e7ff',
                        fontSize: 11,
                        fontWeight: '700',
                        textAlign: col.right ? 'right' : 'left',
                        paddingHorizontal: 4,
                      }}
                    >
                      {col.label.toUpperCase()}
                    </Text>
                  ))}
                </View>

                {/* Table rows */}
                {tableTransactions.length === 0 ? (
                  <View style={{ paddingVertical: 48, alignItems: 'center', minWidth: 590 }}>
                    <FontAwesome name="search" size={28} color="#cbd5e1" />
                    <Text style={{ color: '#94a3b8', marginTop: 12, fontSize: 14 }}>No transactions found</Text>
                  </View>
                ) : (
                  tableTransactions.map((item, index) => {
                    const isIncome = item.type === 'INCOME';
                    const isTransfer = item.type === 'TRANSFER';
                    const runBal = transactionBalances.get(item.id) ?? 0;
                    const evenRow = index % 2 === 0;
                    const rowBg = isDark
                      ? (evenRow ? '#1e293b' : '#0f172a')
                      : (evenRow ? '#ffffff' : '#f8fafc');
                    const textColor = theme.text;
                    const mutedColor = isDark ? '#64748b' : '#94a3b8';
                    const firstTag = item.tags?.[0];

                    return (
                      <TouchableOpacity
                        key={item.id}
                        onPress={() => router.push(`/transaction/${item.id}`)}
                        activeOpacity={0.7}
                        style={{
                          flexDirection: 'row',
                          backgroundColor: rowBg,
                          paddingVertical: 9,
                          paddingHorizontal: 6,
                          borderBottomWidth: 1,
                          borderBottomColor: isDark ? '#1e293b' : '#f1f5f9',
                        }}
                      >
                        <Text style={{ width: 62, fontSize: 11, color: mutedColor, paddingHorizontal: 4 }} numberOfLines={1}>
                          {formatTableDate(item.date)}
                        </Text>
                        <Text style={{ width: 130, fontSize: 12, color: textColor, fontWeight: '500', paddingHorizontal: 4 }} numberOfLines={1}>
                          {item.description || '—'}
                        </Text>
                        <Text style={{ width: 80, fontSize: 11, color: mutedColor, paddingHorizontal: 4 }} numberOfLines={1}>
                          {item.category || '—'}
                        </Text>
                        <Text style={{ width: 68, fontSize: 11, color: '#6366f1', paddingHorizontal: 4 }} numberOfLines={1}>
                          {firstTag ? `#${firstTag}` : '—'}
                        </Text>
                        <Text style={{ width: 80, fontSize: 12, color: '#ef4444', textAlign: 'right', fontWeight: '500', paddingHorizontal: 4 }} numberOfLines={1}>
                          {!isIncome && !isTransfer ? formatCurrency(item.amount) : ''}
                        </Text>
                        <Text style={{ width: 80, fontSize: 12, color: '#16a34a', textAlign: 'right', fontWeight: '500', paddingHorizontal: 4 }} numberOfLines={1}>
                          {isIncome ? formatCurrency(item.amount) : isTransfer ? `↔ ${formatCurrency(item.amount)}` : ''}
                        </Text>
                        <Text style={{ width: 90, fontSize: 12, color: runBal < 0 ? '#ef4444' : textColor, textAlign: 'right', fontWeight: '700', paddingHorizontal: 4 }} numberOfLines={1}>
                          {formatCurrency(runBal)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })
                )}

                {/* Totals footer */}
                {tableTransactions.length > 0 && (
                  <View style={{
                    flexDirection: 'row',
                    backgroundColor: isDark ? '#312e81' : '#eef2ff',
                    paddingVertical: 10,
                    paddingHorizontal: 6,
                    borderTopWidth: 2,
                    borderTopColor: isDark ? '#4338ca' : '#c7d2fe',
                  }}>
                    <Text style={{ width: 62, paddingHorizontal: 4 }} />
                    <Text style={{ width: 130, fontSize: 11, fontWeight: '700', color: isDark ? '#a5b4fc' : '#4338ca', paddingHorizontal: 4 }}>TOTAL</Text>
                    <Text style={{ width: 80, paddingHorizontal: 4 }} />
                    <Text style={{ width: 68, paddingHorizontal: 4 }} />
                    <Text style={{ width: 80, fontSize: 12, color: '#ef4444', textAlign: 'right', fontWeight: '700', paddingHorizontal: 4 }}>
                      {formatCurrency(totals.expense)}
                    </Text>
                    <Text style={{ width: 80, fontSize: 12, color: '#16a34a', textAlign: 'right', fontWeight: '700', paddingHorizontal: 4 }}>
                      {formatCurrency(totals.income)}
                    </Text>
                    <Text style={{ width: 90, paddingHorizontal: 4 }} />
                  </View>
                )}
              </View>
            </ScrollView>
          </ScrollView>
        </View>
      )}

      {/* Category Filter Modal */}
      <Modal visible={showCategoryModal} transparent animationType="slide" onRequestClose={() => setShowCategoryModal(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }} activeOpacity={1} onPress={() => setShowCategoryModal(false)} />
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: theme.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '75%' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: isDark ? '#1e293b' : '#e2e8f0' }}>
            <TouchableOpacity onPress={() => { setSelectedCategories([]); setShowCategoryModal(false); }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: '#94a3b8' }}>Clear</Text>
            </TouchableOpacity>
            <Text style={{ fontSize: 16, fontWeight: '700', color: theme.text }}>Category</Text>
            <TouchableOpacity onPress={() => setShowCategoryModal(false)}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#6366f1' }}>Done</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={{ paddingHorizontal: 16, paddingTop: 8 }} contentContainerStyle={{ paddingBottom: 32 }}>
            {rootCategories.map((cat) => {
              const children = getChildCategories(cat.id);
              const isSelected = selectedCategories.includes(cat.name);
              return (
                <View key={cat.id}>
                  <TouchableOpacity
                    onPress={() => setSelectedCategories(prev => prev.includes(cat.name) ? prev.filter(c => c !== cat.name) : [...prev, cat.name])}
                    style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12, marginBottom: 2, backgroundColor: isSelected ? (isDark ? '#312e81' : '#eef2ff') : 'transparent' }}
                  >
                    <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: cat.color + '30', justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
                      <CategoryIcon icon={cat.icon} size={15} color={cat.color} />
                    </View>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: isSelected ? '#6366f1' : (theme.text), flex: 1 }}>{cat.name}</Text>
                    {isSelected && <FontAwesome name="check" size={14} color="#6366f1" />}
                  </TouchableOpacity>
                  {children.map((child) => {
                    const isChildSelected = selectedCategories.includes(child.name);
                    return (
                      <TouchableOpacity
                        key={child.id}
                        onPress={() => setSelectedCategories(prev => prev.includes(child.name) ? prev.filter(c => c !== child.name) : [...prev, child.name])}
                        style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, paddingLeft: 28, borderRadius: 12, marginBottom: 2, backgroundColor: isChildSelected ? (isDark ? '#312e81' : '#eef2ff') : 'transparent' }}
                      >
                        <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: child.color + '25', justifyContent: 'center', alignItems: 'center', marginRight: 10 }}>
                          <CategoryIcon icon={child.icon} size={12} color={child.color} />
                        </View>
                        <Text style={{ fontSize: 13, fontWeight: '500', color: isChildSelected ? '#6366f1' : (theme.textMuted), flex: 1 }}>{child.name}</Text>
                        {isChildSelected && <FontAwesome name="check" size={12} color="#6366f1" />}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              );
            })}
          </ScrollView>
        </View>
      </Modal>

      {/* Tag Filter Modal */}
      <Modal visible={showTagModal} transparent animationType="slide" onRequestClose={() => setShowTagModal(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }} activeOpacity={1} onPress={() => setShowTagModal(false)} />
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: theme.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '65%' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: isDark ? '#1e293b' : '#e2e8f0' }}>
            <TouchableOpacity onPress={() => { setSelectedTags([]); setShowTagModal(false); }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: '#94a3b8' }}>Clear</Text>
            </TouchableOpacity>
            <Text style={{ fontSize: 16, fontWeight: '700', color: theme.text }}>Tags</Text>
            <TouchableOpacity onPress={() => setShowTagModal(false)}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#6366f1' }}>Done</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={{ paddingHorizontal: 16, paddingTop: 8 }} contentContainerStyle={{ paddingBottom: 32 }}>
            {allTags.length === 0 ? (
              <Text style={{ textAlign: 'center', color: '#94a3b8', marginTop: 24, fontSize: 14 }}>No tags found</Text>
            ) : allTags.map((tag) => {
              const isActive = selectedTags.some(t => t.toLowerCase() === tag.toLowerCase());
              return (
                <TouchableOpacity
                  key={tag}
                  onPress={() => setSelectedTags(prev => prev.some(t => t.toLowerCase() === tag.toLowerCase()) ? prev.filter(t => t.toLowerCase() !== tag.toLowerCase()) : [...prev, tag])}
                  style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12, marginBottom: 2, backgroundColor: isActive ? (isDark ? '#312e81' : '#eef2ff') : 'transparent' }}
                >
                  <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: isActive ? '#6366f1' : (isDark ? '#1e293b' : '#e2e8f0'), justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
                    <FontAwesome name="hashtag" size={14} color={isActive ? '#fff' : '#94a3b8'} />
                  </View>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: isActive ? '#6366f1' : (theme.text), flex: 1 }}>#{tag}</Text>
                  {isActive && <FontAwesome name="check" size={14} color="#6366f1" />}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </Modal>

      {/* Account Filter Modal */}
      <Modal visible={showAccountModal} transparent animationType="slide" onRequestClose={() => setShowAccountModal(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }} activeOpacity={1} onPress={() => setShowAccountModal(false)} />
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: theme.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '65%' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: isDark ? '#1e293b' : '#e2e8f0' }}>
            <TouchableOpacity onPress={() => { setFilterAccountIds([]); setShowAccountModal(false); }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: '#94a3b8' }}>Clear</Text>
            </TouchableOpacity>
            <Text style={{ fontSize: 16, fontWeight: '700', color: theme.text }}>Account</Text>
            <TouchableOpacity onPress={() => setShowAccountModal(false)}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#6366f1' }}>Done</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={{ paddingHorizontal: 16, paddingTop: 8 }} contentContainerStyle={{ paddingBottom: 32 }}>
            {accounts.map((acc) => {
              const isActive = filterAccountIds.includes(acc.id);
              return (
                <TouchableOpacity
                  key={acc.id}
                  onPress={() => setFilterAccountIds(prev => prev.includes(acc.id) ? prev.filter(a => a !== acc.id) : [...prev, acc.id])}
                  style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12, marginBottom: 2, backgroundColor: isActive ? (isDark ? '#312e81' : '#eef2ff') : 'transparent' }}
                >
                  <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: isActive ? '#6366f1' : (isDark ? '#1e293b' : '#e2e8f0'), justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
                    <FontAwesome name="credit-card" size={14} color={isActive ? '#fff' : '#94a3b8'} />
                  </View>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: isActive ? '#6366f1' : (theme.text), flex: 1 }}>{acc.name}</Text>
                  {isActive && <FontAwesome name="check" size={14} color="#6366f1" />}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </Modal>

      {/* Date Filter Modal */}
      <Modal visible={showDateModal} transparent animationType="slide" onRequestClose={() => setShowDateModal(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }} activeOpacity={1} onPress={() => setShowDateModal(false)} />
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: theme.background, borderTopLeftRadius: 24, borderTopRightRadius: 24 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: isDark ? '#1e293b' : '#e2e8f0' }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: theme.text }}>Date Range</Text>
            <TouchableOpacity onPress={() => setShowDateModal(false)}>
              <FontAwesome name="times" size={18} color="#94a3b8" />
            </TouchableOpacity>
          </View>
          <View style={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 32, gap: 12 }}>
            <TouchableOpacity
              onPress={() => {
                if (Platform.OS === 'android') {
                  DateTimePickerAndroid.open({
                    value: dateFrom ?? new Date(),
                    mode: 'date',
                    onChange: (event, date) => { if (event.type === 'set' && date) setDateFrom(date); },
                  });
                } else {
                  setShowDatePicker('from');
                }
              }}
              style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.surface, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, borderWidth: 1, borderColor: dateFrom ? '#6366f1' : (theme.border) }}
            >
              <FontAwesome name="calendar-o" size={16} color={dateFrom ? '#6366f1' : '#94a3b8'} style={{ marginRight: 12 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, color: '#94a3b8', fontWeight: '500', marginBottom: 2 }}>From Date</Text>
                <Text style={{ fontSize: 14, fontWeight: '600', color: dateFrom ? (theme.text) : '#94a3b8' }}>
                  {dateFrom ? dateFrom.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : 'Select start date'}
                </Text>
              </View>
              {dateFrom && (
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close" onPress={() => setDateFrom(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <FontAwesome name="times-circle" size={16} color="#94a3b8" />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                if (Platform.OS === 'android') {
                  DateTimePickerAndroid.open({
                    value: dateTo ?? new Date(),
                    mode: 'date',
                    onChange: (event, date) => { if (event.type === 'set' && date) setDateTo(date); },
                  });
                } else {
                  setShowDatePicker('to');
                }
              }}
              style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.surface, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, borderWidth: 1, borderColor: dateTo ? '#6366f1' : (theme.border) }}
            >
              <FontAwesome name="calendar-o" size={16} color={dateTo ? '#6366f1' : '#94a3b8'} style={{ marginRight: 12 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, color: '#94a3b8', fontWeight: '500', marginBottom: 2 }}>To Date</Text>
                <Text style={{ fontSize: 14, fontWeight: '600', color: dateTo ? (theme.text) : '#94a3b8' }}>
                  {dateTo ? dateTo.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : 'Select end date'}
                </Text>
              </View>
              {dateTo && (
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close" onPress={() => setDateTo(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <FontAwesome name="times-circle" size={16} color="#94a3b8" />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
              <TouchableOpacity
                onPress={() => { setDateFrom(null); setDateTo(null); setShowDateModal(false); }}
                style={{ flex: 1, paddingVertical: 13, borderRadius: 14, backgroundColor: isDark ? '#1e293b' : '#f1f5f9', alignItems: 'center', borderWidth: 1, borderColor: theme.border }}
              >
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#94a3b8' }}>Clear</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setShowDateModal(false)}
                style={{ flex: 2, paddingVertical: 13, borderRadius: 14, backgroundColor: '#6366f1', alignItems: 'center' }}
              >
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#fff' }}>Apply</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Export menu */}
      {showExportMenu && (
        <Modal transparent animationType="fade" onRequestClose={() => setShowExportMenu(false)}>
          <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }} onPress={() => setShowExportMenu(false)} activeOpacity={1}>
            <View style={{ position: 'absolute', right: 16, top: '40%', backgroundColor: theme.surface, borderRadius: 16, paddingVertical: 6, minWidth: 200, elevation: 12, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, borderWidth: 1, borderColor: theme.border }}>
              <TouchableOpacity onPress={() => handleExport('pdf')} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 }}>
                <FontAwesome name="file-pdf-o" size={16} color="#ef4444" style={{ marginRight: 12 }} />
                <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}>Export as PDF</Text>
              </TouchableOpacity>
              <View style={{ height: 1, backgroundColor: theme.surfaceMuted, marginHorizontal: 16 }} />
              <TouchableOpacity onPress={() => handleExport('excel')} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 }}>
                <FontAwesome name="file-excel-o" size={16} color="#16a34a" style={{ marginRight: 12 }} />
                <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}>Export as Excel</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      )}

      {/* Date picker */}
      {Platform.OS !== 'android' && (
        <SpinnerPickerSheet
          show={showDatePicker !== null}
          value={showDatePicker === 'from' ? (dateFrom ?? new Date()) : (dateTo ?? new Date())}
          mode="date"
          label={showDatePicker === 'from' ? 'From Date' : 'To Date'}
          onClose={() => setShowDatePicker(null)}
          onConfirm={(d) => { if (showDatePicker === 'from') setDateFrom(d); else setDateTo(d); }}
        />
      )}
    </View>
  );
}
