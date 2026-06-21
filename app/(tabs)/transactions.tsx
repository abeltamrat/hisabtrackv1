import { BUNDLED_LOGOS } from '@/assets/bankLogos/et';
import CategoryIcon from '@/components/CategoryIcon';
import { useTransactions } from '@/context/TransactionContext';
import { useAppSettings } from '@/contexts/AppSettingsContext';
import { useI18n } from '@/contexts/I18nContext';
import { useTheme } from '@/contexts/ThemeContext';
import { RootState } from '@/store';
import { fetchTransactions } from '@/store/slices/transactionsSlice';
import ExportService from '@/services/ExportService';
import { hasTag } from '@/utils/tags';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Modal, Platform, ScrollView, Text, TextInput, TouchableOpacity, View, useColorScheme } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';

import { useDispatch, useSelector } from 'react-redux';

function getAccountImageSource(logoUrl: string | null | undefined) {
  if (!logoUrl) return undefined;
  const bundled = BUNDLED_LOGOS.find(b => b.url === logoUrl);
  if (bundled && bundled.src) {
    if (typeof bundled.src === 'number') return bundled.src;
    if (typeof bundled.src === 'string') return { uri: bundled.src };
    if (typeof bundled.src === 'object') {
      // @ts-ignore
      if (bundled.src.uri) return bundled.src;
      // @ts-ignore
      if (bundled.src.default) return { uri: bundled.src.default };
      return bundled.src;
    }
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
  React.useEffect(() => { if (show) pendingRef.current = value; }, [show]);
  if (!show) return null;
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
        <TouchableOpacity style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} activeOpacity={1} onPress={onClose} />
        <View style={{ backgroundColor: isDark ? '#1e293b' : '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: isDark ? '#334155' : '#e2e8f0' }}>
            <TouchableOpacity onPress={onClose}>
              <Text style={{ color: '#94a3b8', fontSize: 16 }}>Cancel</Text>
            </TouchableOpacity>
            <Text style={{ color: isDark ? '#e2e8f0' : '#1e293b', fontWeight: '700', fontSize: 16 }}>{label}</Text>
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
  const { type, tag } = params as { type?: string; tag?: string };
  const dispatch = useDispatch();
  const { items: transactions, loading } = useSelector((state: RootState) => state.transactions);
  const accounts = useSelector((state: RootState) => state.accounts.items);
  const { categories } = useTransactions();
  const { t } = useI18n();
  const { formatCurrency, fontSize } = useAppSettings();
  const { actualTheme } = useTheme();
  const isDark = actualTheme === 'dark';
  const isVerySmall = fontSize === 'V.Small';
  const headerTitleSize = fontSize === 'V.Small' ? 'text-lg' : fontSize === 'Small' ? 'text-xl' : fontSize === 'Large' ? 'text-3xl' : 'text-2xl';
  const labelSize = fontSize === 'V.Small' ? 'text-[11px]' : fontSize === 'Small' ? 'text-xs' : fontSize === 'Large' ? 'text-base' : 'text-sm';
  const denseButtonPadding = isVerySmall ? 'py-1.5' : 'py-2';
  const categoryChipPadding = isVerySmall ? 'px-2.5 py-1' : 'px-3 py-1.5';
  const categoryChildChipPadding = isVerySmall ? 'px-2 py-0.5' : 'px-2.5 py-1';
  const summaryValueSize = fontSize === 'V.Small' ? 'text-base' : 'text-lg';
  const [filter, setFilter] = useState<'ALL' | 'INCOME' | 'EXPENSE'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
  const [filterAccountId, setFilterAccountId] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState<Date | null>(null);
  const [dateTo, setDateTo] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState<'from' | 'to' | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Organize categories hierarchically
  const filteredCategories = categories.filter(c => filter === 'ALL' || c.type === filter.toLowerCase());
  const rootCategories = filteredCategories.filter(c => !c.parentId);
  const getChildCategories = (parentId: string) => filteredCategories.filter(c => c.parentId === parentId);

  // Get all category names that should be included when a category is selected
  const getCategoryNamesToInclude = (selectedCatName: string | null) => {
    if (!selectedCatName) return null; // null means include all categories

    const selectedCat = categories.find(c => c.name === selectedCatName);
    if (!selectedCat) return [selectedCatName]; // fallback

    // If it's a parent category (no parentId), include parent + all children
    if (!selectedCat.parentId) {
      const childCategories = getChildCategories(selectedCat.id);
      return [selectedCat.name, ...childCategories.map(c => c.name)];
    }

    // If it's a child category, only include that specific category
    return [selectedCat.name];
  };

  useEffect(() => {
    // @ts-ignore
    dispatch(fetchTransactions());
  }, [dispatch]);

  useEffect(() => {
    if (type && (type === 'INCOME' || type === 'EXPENSE')) {
      setFilter(type);
    }
  }, [type]);

  useEffect(() => {
    if (typeof tag === 'string' && tag.trim()) {
      setSelectedTag(tag.trim());
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
    const categoriesToInclude = getCategoryNamesToInclude(selectedCategory);

    return transactions.filter((t) => {
      // Type filter
      if (filter !== 'ALL' && t.type !== filter) return false;

      // Category filter
      if (categoriesToInclude && !categoriesToInclude.includes(t.category)) return false;

      // Tag filter
      if (!hasTag(t.tags, selectedTag)) return false;

      // Account filter (applies to both card and table views)
      if (filterAccountId && t.account_id !== filterAccountId && t.to_account_id !== filterAccountId) return false;

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
  }, [transactions, filter, selectedCategory, selectedTag, searchQuery, categories, filterAccountId, dateFrom, dateTo]);

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
        dateKey = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }

      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(transaction);
    });

    return Object.entries(groups).map(([date, items]) => ({ date, items }));
  }, [filteredTransactions]);

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  const totals = useMemo(() => {
    const income = filteredTransactions.filter(t => t.type === 'INCOME').reduce((sum, t) => sum + t.amount, 0);
    const expense = filteredTransactions.filter(t => t.type === 'EXPENSE').reduce((sum, t) => sum + t.amount, 0);
    return { income, expense };
  }, [filteredTransactions]);

  const categoriesMap = useMemo(() => new Map(categories.map(c => [c.name, c])), [categories]);
  const accountsMap = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts]);

  // Running balance per transaction (account-aware)
  const transactionBalances = useMemo(() => {
    const baseBalance = filterAccountId
      ? (accounts.find(a => a.id === filterAccountId)?.balance ?? 0)
      : accounts.reduce((sum, a) => sum + (a.balance ?? 0), 0);
    const sorted = [...transactions].sort((a, b) => a.date - b.date);
    const getTxDelta = (t: typeof sorted[number]) => {
      if (!filterAccountId) {
        if (t.type === 'INCOME') return t.amount;
        if (t.type === 'EXPENSE') return -t.amount;
        return 0;
      }
      if (t.type === 'INCOME' && t.account_id === filterAccountId) return t.amount;
      if (t.type === 'EXPENSE' && t.account_id === filterAccountId) return -t.amount;
      if (t.type === 'TRANSFER') {
        if (t.account_id === filterAccountId) return -t.amount;
        if (t.to_account_id === filterAccountId) return t.amount;
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
  }, [transactions, accounts, filterAccountId]);

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
    const d = new Date(ts);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <View className="flex-1 bg-slate-50 dark:bg-background-dark">
      <StatusBar style="auto" />

      {/* Header */}
      <View className="px-6 pt-4 pb-2">
        <View className="flex-row justify-between items-center mb-6">
          <Text className={`text-slate-900 dark:text-white ${headerTitleSize} font-bold`}>{t('transactions')}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity
              onPress={() => setViewMode('card')}
              style={{
                width: isVerySmall ? 36 : 40, height: isVerySmall ? 36 : 40,
                borderRadius: 12, justifyContent: 'center', alignItems: 'center',
                backgroundColor: viewMode === 'card' ? '#6366f1' : (isDark ? '#1e293b' : '#ffffff'),
                borderWidth: 1,
                borderColor: viewMode === 'card' ? '#6366f1' : (isDark ? '#334155' : '#e2e8f0'),
                elevation: 1,
              }}
            >
              <FontAwesome name="th-large" size={isVerySmall ? 14 : 16} color={viewMode === 'card' ? '#ffffff' : '#64748b'} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setViewMode('table')}
              style={{
                width: isVerySmall ? 36 : 40, height: isVerySmall ? 36 : 40,
                borderRadius: 12, justifyContent: 'center', alignItems: 'center',
                backgroundColor: viewMode === 'table' ? '#6366f1' : (isDark ? '#1e293b' : '#ffffff'),
                borderWidth: 1,
                borderColor: viewMode === 'table' ? '#6366f1' : (isDark ? '#334155' : '#e2e8f0'),
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
            <TouchableOpacity onPress={() => setSearchQuery('')}>
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
                  colors={['#6366f1', '#4f46e5']}
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

        {/* Category Filters */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-6 px-6 mb-2">
          <TouchableOpacity
            onPress={() => setSelectedCategory(null)}
            className={`mr-3 ${categoryChipPadding} rounded-full border-2 ${selectedCategory === null
              ? 'bg-primary-500 border-primary-500'
              : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
              }`}
          >
            <Text className={`${labelSize} font-bold ${selectedCategory === null ? 'text-white' : 'text-slate-700 dark:text-slate-300'}`}>
              All
            </Text>
          </TouchableOpacity>
          {rootCategories.map((category) => {
            const isParentSelected = selectedCategory === category.name;
            const childCategories = getChildCategories(category.id);

            return (
              <View key={category.id} className="flex-col mr-3">
                {/* Parent Category */}
                <TouchableOpacity
                  onPress={() => setSelectedCategory(category.name)}
                  className={`${categoryChipPadding} rounded-full border-2 flex-row items-center mb-2 ${isParentSelected
                    ? 'border-primary-500'
                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                    }`}
                  style={isParentSelected ? { backgroundColor: category.color + '20', borderColor: category.color } : {}}
                >
                  <CategoryIcon icon={category.icon} size={isVerySmall ? 11 : 12} color={isParentSelected ? category.color : '#64748b'} />
                  <Text className={`${labelSize} font-bold ml-2 ${isParentSelected ? 'text-slate-900 dark:text-white' : 'text-slate-700 dark:text-slate-300'}`}>
                    {category.name}
                  </Text>
                </TouchableOpacity>

                {/* Child Categories - Show only when parent is selected */}
                {isParentSelected && childCategories.length > 0 && (
                  <View className="flex-row flex-wrap">
                    {childCategories.map((childCat) => (
                      <TouchableOpacity
                        key={childCat.id}
                        onPress={() => setSelectedCategory(childCat.name)}
                        className={`mr-2 mb-1 ${categoryChildChipPadding} rounded-full border flex-row items-center ${selectedCategory === childCat.name
                          ? 'border-primary-500'
                          : 'bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600'
                          }`}
                        style={selectedCategory === childCat.name ? { backgroundColor: childCat.color + '20', borderColor: childCat.color } : {}}
                      >
                        <CategoryIcon icon={childCat.icon} size={isVerySmall ? 9 : 10} color={selectedCategory === childCat.name ? childCat.color : '#64748b'} />
                        <Text className={`${isVerySmall ? 'text-[11px]' : 'text-xs'} font-semibold ml-1 ${selectedCategory === childCat.name ? 'text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-400'}`}>
                          {childCat.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>

        {/* Tag Filters */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-6 px-6 mb-2">
          <TouchableOpacity
            onPress={() => setSelectedTag(null)}
            className={`mr-2 px-3 py-1 rounded-full border-2 ${selectedTag === null
              ? 'bg-indigo-500 border-indigo-500'
              : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
              }`}
          >
            <Text className={`${labelSize} font-bold ${selectedTag === null ? 'text-white' : 'text-slate-700 dark:text-slate-300'}`}>
              All Tags
            </Text>
          </TouchableOpacity>
          {allTags.map((transactionTag) => {
            const active = selectedTag?.toLowerCase() === transactionTag.toLowerCase();
            return (
              <TouchableOpacity
                key={transactionTag}
                onPress={() => setSelectedTag(transactionTag)}
                className={`mr-2 px-3 py-1 rounded-full border ${active
                  ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-500'
                  : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                  }`}
              >
                <Text className={`${isVerySmall ? 'text-[11px]' : 'text-xs'} font-semibold ${active ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-600 dark:text-slate-400'}`}>
                  #{transactionTag}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Account Filter - applies to both card and table views */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-6 px-6 mb-2">
          <TouchableOpacity
            onPress={() => setFilterAccountId(null)}
            className={`mr-2 px-3 py-1 rounded-full border-2 ${!filterAccountId ? 'bg-primary-500 border-primary-500' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}
          >
            <Text className={`${labelSize} font-bold ${!filterAccountId ? 'text-white' : 'text-slate-700 dark:text-slate-300'}`}>All Accounts</Text>
          </TouchableOpacity>
          {accounts.map(acc => (
            <TouchableOpacity
              key={acc.id}
              onPress={() => setFilterAccountId(filterAccountId === acc.id ? null : acc.id)}
              className={`mr-2 px-3 py-1 rounded-full border-2 ${filterAccountId === acc.id ? 'bg-primary-500 border-primary-500' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}
            >
              <Text className={`${labelSize} font-bold ${filterAccountId === acc.id ? 'text-white' : 'text-slate-700 dark:text-slate-300'}`}>{acc.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Date Range Filter - applies to both card and table views */}
        <View className="flex-row items-center mb-2" style={{ gap: 6 }}>
          <TouchableOpacity
            onPress={() => {
              if (Platform.OS === 'android') {
                DateTimePickerAndroid.open({
                  value: dateFrom ?? new Date(),
                  mode: 'date',
                  onChange: (event, date) => {
                    if (event.type === 'set' && date) {
                      setDateFrom(date);
                    }
                  },
                });
              } else {
                setShowDatePicker('from');
              }
            }}
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, backgroundColor: isDark ? '#1e293b' : '#fff', borderWidth: 1, borderColor: dateFrom ? '#6366f1' : (isDark ? '#334155' : '#e2e8f0') }}
          >
            <FontAwesome name="calendar-o" size={10} color={dateFrom ? '#6366f1' : '#94a3b8'} style={{ marginRight: 5 }} />
            <Text style={{ fontSize: 11, color: dateFrom ? '#6366f1' : '#94a3b8', fontWeight: '600' }} numberOfLines={1}>
              {dateFrom ? dateFrom.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : 'From Date'}
            </Text>
          </TouchableOpacity>
          <Text style={{ color: '#94a3b8', fontSize: 11 }}>→</Text>
          <TouchableOpacity
            onPress={() => {
              if (Platform.OS === 'android') {
                DateTimePickerAndroid.open({
                  value: dateTo ?? new Date(),
                  mode: 'date',
                  onChange: (event, date) => {
                    if (event.type === 'set' && date) {
                      setDateTo(date);
                    }
                  },
                });
              } else {
                setShowDatePicker('to');
              }
            }}
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, backgroundColor: isDark ? '#1e293b' : '#fff', borderWidth: 1, borderColor: dateTo ? '#6366f1' : (isDark ? '#334155' : '#e2e8f0') }}
          >
            <FontAwesome name="calendar-o" size={10} color={dateTo ? '#6366f1' : '#94a3b8'} style={{ marginRight: 5 }} />
            <Text style={{ fontSize: 11, color: dateTo ? '#6366f1' : '#94a3b8', fontWeight: '600' }} numberOfLines={1}>
              {dateTo ? dateTo.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : 'To Date'}
            </Text>
          </TouchableOpacity>
          {(dateFrom || dateTo) && (
            <TouchableOpacity
              onPress={() => { setDateFrom(null); setDateTo(null); }}
              style={{ padding: 6, borderRadius: 8, backgroundColor: isDark ? '#1e293b' : '#fff', borderWidth: 1, borderColor: isDark ? '#334155' : '#e2e8f0' }}
            >
              <FontAwesome name="times" size={11} color="#94a3b8" />
            </TouchableOpacity>
          )}
        </View>

        {/* Summary */}
        <View className="flex-row bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 overflow-hidden">
          <View className="flex-1 items-center py-2">
            <Text className="text-slate-400 dark:text-slate-500 text-[10px] font-semibold uppercase mb-0.5">{t('income')}</Text>
            <Text className="text-green-600 text-xs font-bold" numberOfLines={1}>{formatCurrency(totals.income)}</Text>
          </View>
          <View className="w-px bg-slate-100 dark:bg-slate-700" />
          <View className="flex-1 items-center py-2">
            <Text className="text-slate-400 dark:text-slate-500 text-[10px] font-semibold uppercase mb-0.5">{t('expense')}</Text>
            <Text className="text-red-500 text-xs font-bold" numberOfLines={1}>{formatCurrency(totals.expense)}</Text>
          </View>
          <View className="w-px bg-slate-100 dark:bg-slate-700" />
          <View className="flex-1 items-center py-2">
            <Text className="text-slate-400 dark:text-slate-500 text-[10px] font-semibold uppercase mb-0.5">{t('total')}</Text>
            <Text className="text-slate-900 dark:text-white text-xs font-bold" numberOfLines={1}>{formatCurrency(totals.income - totals.expense)}</Text>
          </View>
        </View>
      </View>

      {viewMode === 'card' ? (
        /* ── Card view (existing) ── */
        <FlatList
          data={groupedTransactions}
          keyExtractor={(item) => item.date}
          contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24 }}
          showsVerticalScrollIndicator={false}
          maxToRenderPerBatch={5}
          windowSize={5}
          initialNumToRender={5}
          removeClippedSubviews={true}
          renderItem={({ item: group }) => (
            <View className="mb-6">
              <Text className="text-slate-500 dark:text-slate-400 text-sm font-bold mb-3">{group.date}</Text>
              {group.items.map((item) => {
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
                        <Text className="text-slate-400 text-xs">{item.category}</Text>
                        <View className="w-1 h-1 bg-slate-300 rounded-full mx-2" />
                        <Text className="text-slate-400 text-xs">{formatTime(item.date)}</Text>
                      </View>
                      {item.tags && item.tags.length > 0 && (
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-2 -mx-0.5 px-0.5">
                          {item.tags.slice(0, 4).map((transactionTag) => (
                            <TouchableOpacity
                              key={`${item.id}-${transactionTag}`}
                              onPress={() => setSelectedTag(transactionTag)}
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
              })}
            </View>
          )}
          ListEmptyComponent={
            <View className="items-center justify-center mt-20">
              <View className="w-20 h-20 bg-slate-100 dark:bg-slate-800 rounded-full justify-center items-center mb-4">
                <FontAwesome name="search" size={32} color="#cbd5e1" />
              </View>
              <Text className="text-slate-900 dark:text-white font-bold text-lg mb-2">{t('noTransactionsFound')}</Text>
              <Text className="text-slate-400 text-sm text-center">
                {searchQuery ? t('tryAdjustingSearch') : t('startAddingTransactions')}
              </Text>
            </View>
          }
        />
      ) : (
        /* ── Bank Statement Table view ── */
        <View style={{ flex: 1 }}>
          {/* Export button bar */}
          <View style={{ paddingHorizontal: 12, paddingVertical: 6, flexDirection: 'row', justifyContent: 'flex-end', borderBottomWidth: 1, borderBottomColor: isDark ? '#1e293b' : '#e2e8f0', backgroundColor: isDark ? '#0f172a' : '#f8fafc' }}>
            <TouchableOpacity
              onPress={() => setShowExportMenu(true)}
              disabled={exporting}
              style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: '#6366f1' }}
            >
              {exporting
                ? <ActivityIndicator size="small" color="#fff" />
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
                    const textColor = isDark ? '#e2e8f0' : '#1e293b';
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

      {/* Floating Action Button - Add Transaction */}
      <TouchableOpacity
        onPress={() => router.push('/modal')}
        className="absolute right-6 shadow-lg"
        style={{ elevation: 6, bottom: 8 }}
      >
        <LinearGradient
          colors={['#6366f1', '#4f46e5']}
          className={`${isVerySmall ? 'w-14 h-14' : 'w-16 h-16'} rounded-full justify-center items-center`}
        >
          <FontAwesome name="plus" size={isVerySmall ? 20 : 22} color="#fff" />
        </LinearGradient>
      </TouchableOpacity>

      {/* Export menu */}
      {showExportMenu && (
        <Modal transparent animationType="fade" onRequestClose={() => setShowExportMenu(false)}>
          <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }} onPress={() => setShowExportMenu(false)} activeOpacity={1}>
            <View style={{ position: 'absolute', right: 16, top: '40%', backgroundColor: isDark ? '#1e293b' : '#ffffff', borderRadius: 16, paddingVertical: 6, minWidth: 200, elevation: 12, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, borderWidth: 1, borderColor: isDark ? '#334155' : '#e2e8f0' }}>
              <TouchableOpacity onPress={() => handleExport('pdf')} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 }}>
                <FontAwesome name="file-pdf-o" size={16} color="#ef4444" style={{ marginRight: 12 }} />
                <Text style={{ color: isDark ? '#e2e8f0' : '#1e293b', fontSize: 14, fontWeight: '600' }}>Export as PDF</Text>
              </TouchableOpacity>
              <View style={{ height: 1, backgroundColor: isDark ? '#334155' : '#f1f5f9', marginHorizontal: 16 }} />
              <TouchableOpacity onPress={() => handleExport('excel')} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 }}>
                <FontAwesome name="file-excel-o" size={16} color="#16a34a" style={{ marginRight: 12 }} />
                <Text style={{ color: isDark ? '#e2e8f0' : '#1e293b', fontSize: 14, fontWeight: '600' }}>Export as Excel</Text>
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
