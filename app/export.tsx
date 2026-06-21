import { useAppSettings } from '@/contexts/AppSettingsContext';
import { useTheme } from '@/contexts/ThemeContext';
import ExportService, { ReportType } from '@/services/ExportService';
import { AppDispatch, RootState } from '@/store';
import { fetchAccounts } from '@/store/slices/accountsSlice';
import { fetchBudgets } from '@/store/slices/budgetsSlice';
import { fetchLoans } from '@/store/slices/loansSlice';
import { fetchTransactions } from '@/store/slices/transactionsSlice';
import { Transaction } from '@/types/database';
import { hasTag } from '@/utils/tags';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { createElement, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, ScrollView, Text, TouchableOpacity, View, useColorScheme } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';

type ExportFormat = 'pdf' | 'excel';
type ExportTimeRange = 'week' | 'month' | 'year' | 'all' | 'custom';
type TransactionFilterType = 'ALL' | Transaction['type'];

interface ExportTypeOption {
  value: ReportType;
  title: string;
  description: string;
  colorClass: string;
  icon: string;
}

const TRANSACTION_TYPE_OPTIONS: TransactionFilterType[] = ['ALL', 'INCOME', 'EXPENSE', 'TRANSFER'];

const normalizeDate = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const formatDateLabel = (date: Date) => normalizeDate(date).toISOString().split('T')[0];

const SpinnerPickerSheet = ({
  show, value, mode, label, onClose, onConfirm, minimumDate, maximumDate,
}: {
  show: boolean; value: Date; mode: 'date' | 'time'; label: string;
  onClose: () => void; onConfirm: (d: Date) => void;
  minimumDate?: Date; maximumDate?: Date;
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
            minimumDate={minimumDate}
            maximumDate={maximumDate}
            style={{ height: 200, alignSelf: 'center', width: '100%' }}
            onChange={(_, d) => { if (d) pendingRef.current = d; }}
          />
        </View>
      </View>
    </Modal>
  );
};

const PlatformDatePicker = React.memo(({
  value,
  onChange,
  minimumDate,
  maximumDate,
}: {
  value: Date;
  onChange: (date: Date) => void;
  minimumDate?: Date;
  maximumDate?: Date;
}) => {
  const [show, setShow] = useState(false);

  if (Platform.OS === 'web') {
    return (
      <View className="bg-slate-50 dark:bg-slate-900 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700">
        {createElement('input', {
          type: 'date',
          value: value.toISOString().split('T')[0],
          min: minimumDate ? minimumDate.toISOString().split('T')[0] : undefined,
          max: maximumDate ? maximumDate.toISOString().split('T')[0] : undefined,
          onChange: (e: any) => {
            if (e.target.value) {
              const next = new Date(e.target.value);
              if (!Number.isNaN(next.getTime())) {
                onChange(next);
              }
            }
          },
          style: {
            padding: 12,
            backgroundColor: 'transparent',
            border: 'none',
            color: '#334155',
            fontSize: 14,
            width: '100%',
            fontFamily: 'inherit',
            outline: 'none',
          },
        })}
      </View>
    );
  }

  return (
    <View>
      <TouchableOpacity
        onPress={() => {
          if (Platform.OS === 'android') {
            DateTimePickerAndroid.open({
              value,
              mode: 'date',
              display: 'default',
              minimumDate,
              maximumDate,
              onChange: (event: any, selectedDate?: Date) => {
                if (event.type === 'set' && selectedDate) {
                  onChange(selectedDate);
                }
              },
            });
          } else {
            setShow(true);
          }
        }}
        className="bg-slate-50 dark:bg-slate-900 p-3 rounded-xl flex-row items-center justify-between border border-slate-200 dark:border-slate-700"
      >
        <Text className="text-slate-900 dark:text-white text-sm font-semibold">{value.toLocaleDateString()}</Text>
        <FontAwesome name="calendar" size={14} color="#64748b" />
      </TouchableOpacity>
      {Platform.OS === 'ios' && show && (
        <DateTimePicker
          value={value}
          mode="date"
          display="spinner"
          minimumDate={minimumDate}
          maximumDate={maximumDate}
          onChange={(_, d) => { if (d) onChange(d); }}
        />
      )}
    </View>
  );
});

export default function ExportDataScreen() {
  const router = useRouter();
  const dispatch = useDispatch<AppDispatch>();
  const { actualTheme } = useTheme();
  const { fontSize, formatCurrency } = useAppSettings();
  const { items: transactions } = useSelector((state: RootState) => state.transactions);
  const { items: accounts } = useSelector((state: RootState) => state.accounts);
  const { items: budgets } = useSelector((state: RootState) => state.budgets);
  const { items: loans } = useSelector((state: RootState) => state.loans);

  const [selectedType, setSelectedType] = useState<ReportType>('transactions');
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('excel');
  const [selectedTimeRange, setSelectedTimeRange] = useState<ExportTimeRange>('month');
  const [customFromDate, setCustomFromDate] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
  });
  const [customToDate, setCustomToDate] = useState<Date>(() => normalizeDate(new Date()));
  const [selectedTransactionType, setSelectedTransactionType] = useState<TransactionFilterType>('ALL');
  const [selectedAccountId, setSelectedAccountId] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedTag, setSelectedTag] = useState<string>('all');
  const [isExporting, setIsExporting] = useState(false);

  const isVerySmall = fontSize === 'V.Small';
  const headerTitleSize = fontSize === 'V.Small' ? 'text-lg' : fontSize === 'Large' ? 'text-2xl' : 'text-xl';
  const sectionTitleSize = fontSize === 'V.Small' ? 'text-base' : fontSize === 'Large' ? 'text-xl' : 'text-lg';
  const helperTextSize = fontSize === 'V.Small' ? 'text-xs' : 'text-sm';
  const cardPaddingClass = isVerySmall ? 'p-3.5' : 'p-4';
  const actionTextSize = fontSize === 'V.Small' ? 'text-sm' : 'text-base';
  const filterChipTextSize = fontSize === 'V.Small' ? 'text-xs' : 'text-sm';
  const isTransactionReport = selectedType === 'transactions' || selectedType === 'summary';

  useEffect(() => {
    dispatch(fetchTransactions());
    dispatch(fetchAccounts());
    dispatch(fetchBudgets());
    dispatch(fetchLoans());
  }, [dispatch]);

  useEffect(() => {
    if (selectedType === 'all_data' && selectedFormat === 'pdf') {
      setSelectedFormat('excel');
    }
  }, [selectedFormat, selectedType]);

  const handleCustomFromDateChange = (nextDate: Date) => {
    const normalizedFrom = normalizeDate(nextDate);
    setCustomFromDate(normalizedFrom);
    if (normalizedFrom.getTime() > normalizeDate(customToDate).getTime()) {
      setCustomToDate(normalizedFrom);
    }
  };

  const handleCustomToDateChange = (nextDate: Date) => {
    const normalizedTo = normalizeDate(nextDate);
    setCustomToDate(normalizedTo);
    if (normalizedTo.getTime() < normalizeDate(customFromDate).getTime()) {
      setCustomFromDate(normalizedTo);
    }
  };

  const categoryOptions = useMemo(() => {
    const categories = new Set<string>();
    transactions.forEach((transaction) => {
      const category = transaction.category?.trim();
      if (category) {
        categories.add(category);
      }
    });
    return [...categories].sort((a, b) => a.localeCompare(b));
  }, [transactions]);

  const tagOptions = useMemo(() => {
    const tags = new Map<string, string>();
    transactions.forEach((transaction) => {
      (transaction.tags || []).forEach((tag) => {
        const normalized = tag.trim();
        if (!normalized) return;
        const key = normalized.toLowerCase();
        if (!tags.has(key)) {
          tags.set(key, normalized);
        }
      });
    });
    return [...tags.values()].sort((a, b) => a.localeCompare(b));
  }, [transactions]);

  useEffect(() => {
    if (selectedAccountId !== 'all' && !accounts.some((account) => account.id === selectedAccountId)) {
      setSelectedAccountId('all');
    }
  }, [accounts, selectedAccountId]);

  useEffect(() => {
    if (selectedCategory !== 'all' && !categoryOptions.includes(selectedCategory)) {
      setSelectedCategory('all');
    }
  }, [categoryOptions, selectedCategory]);

  useEffect(() => {
    if (selectedTag !== 'all' && !tagOptions.some((tag) => tag.toLowerCase() === selectedTag.toLowerCase())) {
      setSelectedTag('all');
    }
  }, [selectedTag, tagOptions]);

  const timeRanges: Array<{ value: ExportTimeRange; label: string }> = [
    { value: 'week', label: 'Week' },
    { value: 'month', label: 'Month' },
    { value: 'year', label: 'Year' },
    { value: 'custom', label: 'Custom' },
    { value: 'all', label: 'All Time' },
  ];

  const exportTypeOptions: ExportTypeOption[] = [
    {
      value: 'transactions',
      title: 'Transactions',
      description: 'Full transaction ledger for the selected period.',
      colorClass: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
      icon: 'list-alt',
    },
    {
      value: 'summary',
      title: 'Summary',
      description: 'Income, expenses, savings rate, and category breakdown.',
      colorClass: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800',
      icon: 'pie-chart',
    },
    {
      value: 'loans',
      title: 'Loans & Debts',
      description: 'Outstanding borrowed/lent balances and statuses.',
      colorClass: 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800',
      icon: 'users',
    },
    {
      value: 'all_data',
      title: 'All Data',
      description: 'Accounts, transactions, budgets, and loans in separate sheets.',
      colorClass: 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800',
      icon: 'database',
    },
  ];

  const filteredTransactions = useMemo(() => {
    if (selectedType === 'all_data') return transactions;

    const now = new Date();
    let results = transactions.filter((transaction) => {
      const date = new Date(transaction.date);
      switch (selectedTimeRange) {
        case 'week': {
          const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          return date >= weekAgo;
        }
        case 'month': {
          const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
          return date >= monthAgo;
        }
        case 'year': {
          const yearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
          return date >= yearAgo;
        }
        case 'custom': {
          const from = normalizeDate(customFromDate).getTime();
          const to = normalizeDate(customToDate).getTime() + (24 * 60 * 60 * 1000 - 1);
          const transactionTime = date.getTime();
          return transactionTime >= from && transactionTime <= to;
        }
        default:
          return true;
      }
    });

    if (isTransactionReport) {
      if (selectedTransactionType !== 'ALL') {
        results = results.filter((transaction) => transaction.type === selectedTransactionType);
      }

      if (selectedAccountId !== 'all') {
        results = results.filter((transaction) =>
          transaction.account_id === selectedAccountId || transaction.to_account_id === selectedAccountId
        );
      }

      if (selectedCategory !== 'all') {
        results = results.filter((transaction) => transaction.category === selectedCategory);
      }

      if (selectedTag !== 'all') {
        results = results.filter((transaction) => hasTag(transaction.tags, selectedTag));
      }
    }

    return results;
  }, [
    customFromDate,
    customToDate,
    isTransactionReport,
    selectedAccountId,
    selectedCategory,
    selectedTag,
    selectedTimeRange,
    selectedTransactionType,
    selectedType,
    transactions,
  ]);

  const exportSummary = useMemo(() => {
    const income = filteredTransactions
      .filter((transaction) => transaction.type === 'INCOME')
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    const expense = filteredTransactions
      .filter((transaction) => transaction.type === 'EXPENSE')
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    const balance = income - expense;
    const savingsRate = income > 0 ? ((income - expense) / income) * 100 : 0;

    return { income, expense, balance, savingsRate };
  }, [filteredTransactions]);

  const canExport = useMemo(() => {
    if (selectedType === 'all_data') {
      return accounts.length > 0 || transactions.length > 0 || budgets.length > 0 || loans.length > 0;
    }
    if (selectedType === 'loans') {
      return loans.length > 0;
    }
    return filteredTransactions.length > 0;
  }, [accounts.length, budgets.length, filteredTransactions.length, loans.length, selectedType, transactions.length]);

  const activeFilterCount = useMemo(() => {
    if (!isTransactionReport) {
      return 0;
    }

    let count = 0;
    if (selectedTimeRange !== 'all') count += 1;
    if (selectedTransactionType !== 'ALL') count += 1;
    if (selectedAccountId !== 'all') count += 1;
    if (selectedCategory !== 'all') count += 1;
    if (selectedTag !== 'all') count += 1;
    return count;
  }, [isTransactionReport, selectedAccountId, selectedCategory, selectedTag, selectedTimeRange, selectedTransactionType]);

  const customDateRangeLabel = useMemo(() => {
    if (selectedTimeRange !== 'custom') {
      return null;
    }
    return `${formatDateLabel(customFromDate)} to ${formatDateLabel(customToDate)}`;
  }, [customFromDate, customToDate, selectedTimeRange]);

  const previewLabel = useMemo(() => {
    if (selectedType === 'all_data') {
      return `${accounts.length} accounts | ${transactions.length} transactions | ${budgets.length} budgets | ${loans.length} loans`;
    }
    if (selectedType === 'loans') {
      return `${loans.length} loan records`;
    }
    if (selectedType === 'summary') {
      const rangeSuffix = customDateRangeLabel ? ` | ${customDateRangeLabel}` : '';
      return `${filteredTransactions.length} transactions | Income ${formatCurrency(exportSummary.income)} | Expense ${formatCurrency(exportSummary.expense)} | ${activeFilterCount} filters${rangeSuffix}`;
    }
    const rangeSuffix = customDateRangeLabel ? ` | ${customDateRangeLabel}` : '';
    return `${filteredTransactions.length} transactions | ${activeFilterCount} filters${rangeSuffix}`;
  }, [
    accounts.length,
    activeFilterCount,
    budgets.length,
    customDateRangeLabel,
    exportSummary.expense,
    exportSummary.income,
    filteredTransactions.length,
    formatCurrency,
    loans.length,
    selectedType,
    transactions.length,
  ]);

  const clearFilters = () => {
    setSelectedTransactionType('ALL');
    setSelectedAccountId('all');
    setSelectedCategory('all');
    setSelectedTag('all');
  };

  const handleExport = async () => {
    if (!canExport) {
      Alert.alert('No Data', 'There is no data available for the selected export.');
      return;
    }

    if (selectedType === 'all_data' && selectedFormat === 'pdf') {
      Alert.alert('Excel only', 'All Data export is available in Excel format only.');
      return;
    }

    setIsExporting(true);
    try {
      const title = selectedType === 'all_data'
        ? 'Complete Financial Backup'
        : selectedType === 'transactions'
          ? 'Transaction History'
          : selectedType === 'summary'
            ? 'Financial Summary Report'
            : 'Loans & Debts Report';

      const exportData = selectedType === 'all_data' ? transactions : filteredTransactions;
      const exportTimeRange = selectedType === 'all_data'
        ? 'All Time'
        : selectedTimeRange === 'all'
          ? 'All Time'
          : selectedTimeRange === 'custom'
            ? `Custom (${formatDateLabel(customFromDate)} to ${formatDateLabel(customToDate)})`
            : selectedTimeRange;

      await ExportService.exportReport({
        data: exportData,
        accounts,
        budgets,
        loans,
        summary: selectedType === 'loans' || selectedType === 'all_data' ? undefined : exportSummary,
        title,
        type: selectedType,
        format: selectedFormat,
        timeRange: exportTimeRange,
      });

      Alert.alert('Export Complete', `${title} was exported as ${selectedFormat.toUpperCase()}.`);
    } catch (error) {
      console.error('Export failed', error);
      Alert.alert('Export Failed', 'Unable to export data. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <View className="flex-1 bg-slate-50 dark:bg-background-dark">
      <StatusBar style="auto" />

      <LinearGradient
        colors={actualTheme === 'dark' ? ['#334155', '#1e293b'] : ['#06b6d4', '#0e7490']}
        className="px-6 pt-6 pb-8 rounded-b-[32px]"
        style={{ elevation: 4 }}
      >
        <View className="flex-row justify-between items-center">
          <TouchableOpacity onPress={() => router.back()} className={`${isVerySmall ? 'w-9 h-9' : 'w-10 h-10'} bg-white/20 rounded-xl justify-center items-center`}>
            <FontAwesome name="arrow-left" size={isVerySmall ? 16 : 18} color="#fff" />
          </TouchableOpacity>
          <Text className={`text-white ${headerTitleSize} font-bold`}>Export Data</Text>
          <View className={`${isVerySmall ? 'w-9 h-9' : 'w-10 h-10'}`} />
        </View>
      </LinearGradient>

      <ScrollView className="flex-1 px-6 -mt-6" showsVerticalScrollIndicator={false}>
        <View className={`bg-white dark:bg-slate-800 rounded-3xl ${isVerySmall ? 'p-4' : 'p-6'} mb-6 shadow-lg border border-slate-100 dark:border-slate-700`} style={{ elevation: 4 }}>
          <Text className={`text-slate-900 dark:text-white font-bold ${sectionTitleSize} mb-2`}>What to Export</Text>
          <Text className={`text-slate-500 ${helperTextSize} mb-4`}>Choose a report type, format, and period.</Text>

          <View className="space-y-3">
            {exportTypeOptions.map((option) => (
              <TouchableOpacity
                key={option.value}
                onPress={() => setSelectedType(option.value)}
                className={`flex-row items-center rounded-2xl border-2 ${cardPaddingClass} ${selectedType === option.value ? option.colorClass : 'bg-slate-50 dark:bg-slate-900 border-transparent'}`}
              >
                <View className={`${isVerySmall ? 'w-9 h-9 mr-3' : 'w-10 h-10 mr-4'} rounded-xl justify-center items-center bg-white/60 dark:bg-slate-800`}>
                  <FontAwesome name={option.icon as any} size={isVerySmall ? 15 : 17} color="#0f172a" />
                </View>
                <View className="flex-1">
                  <Text className={`text-slate-900 dark:text-white font-bold ${actionTextSize}`}>{option.title}</Text>
                  <Text className={`text-slate-500 ${helperTextSize}`}>{option.description}</Text>
                </View>
                {selectedType === option.value ? (
                  <FontAwesome name="check-circle" size={isVerySmall ? 18 : 20} color="#0ea5e9" />
                ) : null}
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {selectedType !== 'all_data' ? (
          <View className={`bg-white dark:bg-slate-800 rounded-3xl ${isVerySmall ? 'p-4' : 'p-6'} mb-6 shadow-lg border border-slate-100 dark:border-slate-700`} style={{ elevation: 4 }}>
            <Text className={`text-slate-900 dark:text-white font-bold ${sectionTitleSize} mb-3`}>Time Range</Text>
            <View className="flex-row flex-wrap">
              {timeRanges.map((range) => (
                <TouchableOpacity
                  key={range.value}
                  onPress={() => setSelectedTimeRange(range.value)}
                  className={`${isVerySmall ? 'px-3 py-1.5' : 'px-4 py-2'} rounded-xl border-2 mr-2 mb-2 ${selectedTimeRange === range.value ? 'bg-sky-50 dark:bg-sky-900/20 border-sky-500' : 'bg-slate-50 dark:bg-slate-900 border-transparent'}`}
                >
                  <Text className={`font-bold ${filterChipTextSize} ${selectedTimeRange === range.value ? 'text-sky-600 dark:text-sky-400' : 'text-slate-700 dark:text-slate-300'}`}>
                    {range.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {selectedTimeRange === 'custom' ? (
              <View className="mt-4">
                <Text className={`text-slate-500 ${helperTextSize} mb-2`}>From</Text>
                <PlatformDatePicker
                  value={customFromDate}
                  onChange={handleCustomFromDateChange}
                  maximumDate={customToDate}
                />
                <Text className={`text-slate-500 ${helperTextSize} mt-3 mb-2`}>To</Text>
                <PlatformDatePicker
                  value={customToDate}
                  onChange={handleCustomToDateChange}
                  minimumDate={customFromDate}
                />
              </View>
            ) : null}
          </View>
        ) : null}

        {isTransactionReport ? (
          <View className={`bg-white dark:bg-slate-800 rounded-3xl ${isVerySmall ? 'p-4' : 'p-6'} mb-6 shadow-lg border border-slate-100 dark:border-slate-700`} style={{ elevation: 4 }}>
            <View className="flex-row justify-between items-center mb-3">
              <Text className={`text-slate-900 dark:text-white font-bold ${sectionTitleSize}`}>Filters</Text>
              <TouchableOpacity
                onPress={clearFilters}
                className={`${isVerySmall ? 'px-3 py-1.5' : 'px-3 py-2'} rounded-xl bg-slate-100 dark:bg-slate-700`}
              >
                <Text className={`font-bold ${helperTextSize} text-slate-600 dark:text-slate-200`}>Clear</Text>
              </TouchableOpacity>
            </View>

            <Text className={`text-slate-500 ${helperTextSize} mb-2`}>Transaction Type</Text>
            <View className="flex-row flex-wrap mb-4">
              {TRANSACTION_TYPE_OPTIONS.map((filterType) => (
                <TouchableOpacity
                  key={filterType}
                  onPress={() => setSelectedTransactionType(filterType)}
                  className={`${isVerySmall ? 'px-3 py-1.5' : 'px-4 py-2'} rounded-xl border-2 mr-2 mb-2 ${selectedTransactionType === filterType ? 'bg-cyan-50 dark:bg-cyan-900/20 border-cyan-500' : 'bg-slate-50 dark:bg-slate-900 border-transparent'}`}
                >
                  <Text className={`font-bold ${filterChipTextSize} ${selectedTransactionType === filterType ? 'text-cyan-600 dark:text-cyan-400' : 'text-slate-700 dark:text-slate-300'}`}>
                    {filterType}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text className={`text-slate-500 ${helperTextSize} mb-2`}>Account</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-4">
              <View className="flex-row pr-2">
                <TouchableOpacity
                  onPress={() => setSelectedAccountId('all')}
                  className={`${isVerySmall ? 'px-3 py-1.5' : 'px-4 py-2'} rounded-xl border-2 mr-2 ${selectedAccountId === 'all' ? 'bg-cyan-50 dark:bg-cyan-900/20 border-cyan-500' : 'bg-slate-50 dark:bg-slate-900 border-transparent'}`}
                >
                  <Text className={`font-bold ${filterChipTextSize} ${selectedAccountId === 'all' ? 'text-cyan-600 dark:text-cyan-400' : 'text-slate-700 dark:text-slate-300'}`}>
                    All Accounts
                  </Text>
                </TouchableOpacity>
                {accounts.map((account) => (
                  <TouchableOpacity
                    key={account.id}
                    onPress={() => setSelectedAccountId(account.id)}
                    className={`${isVerySmall ? 'px-3 py-1.5' : 'px-4 py-2'} rounded-xl border-2 mr-2 ${selectedAccountId === account.id ? 'bg-cyan-50 dark:bg-cyan-900/20 border-cyan-500' : 'bg-slate-50 dark:bg-slate-900 border-transparent'}`}
                  >
                    <Text className={`font-bold ${filterChipTextSize} ${selectedAccountId === account.id ? 'text-cyan-600 dark:text-cyan-400' : 'text-slate-700 dark:text-slate-300'}`}>
                      {account.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <Text className={`text-slate-500 ${helperTextSize} mb-2`}>Category</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View className="flex-row pr-2">
                <TouchableOpacity
                  onPress={() => setSelectedCategory('all')}
                  className={`${isVerySmall ? 'px-3 py-1.5' : 'px-4 py-2'} rounded-xl border-2 mr-2 ${selectedCategory === 'all' ? 'bg-cyan-50 dark:bg-cyan-900/20 border-cyan-500' : 'bg-slate-50 dark:bg-slate-900 border-transparent'}`}
                >
                  <Text className={`font-bold ${filterChipTextSize} ${selectedCategory === 'all' ? 'text-cyan-600 dark:text-cyan-400' : 'text-slate-700 dark:text-slate-300'}`}>
                    All Categories
                  </Text>
                </TouchableOpacity>
                {categoryOptions.map((category) => (
                  <TouchableOpacity
                    key={category}
                    onPress={() => setSelectedCategory(category)}
                    className={`${isVerySmall ? 'px-3 py-1.5' : 'px-4 py-2'} rounded-xl border-2 mr-2 ${selectedCategory === category ? 'bg-cyan-50 dark:bg-cyan-900/20 border-cyan-500' : 'bg-slate-50 dark:bg-slate-900 border-transparent'}`}
                  >
                    <Text className={`font-bold ${filterChipTextSize} ${selectedCategory === category ? 'text-cyan-600 dark:text-cyan-400' : 'text-slate-700 dark:text-slate-300'}`}>
                      {category}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <Text className={`text-slate-500 ${helperTextSize} mt-4 mb-2`}>Tag</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View className="flex-row pr-2">
                <TouchableOpacity
                  onPress={() => setSelectedTag('all')}
                  className={`${isVerySmall ? 'px-3 py-1.5' : 'px-4 py-2'} rounded-xl border-2 mr-2 ${selectedTag === 'all' ? 'bg-cyan-50 dark:bg-cyan-900/20 border-cyan-500' : 'bg-slate-50 dark:bg-slate-900 border-transparent'}`}
                >
                  <Text className={`font-bold ${filterChipTextSize} ${selectedTag === 'all' ? 'text-cyan-600 dark:text-cyan-400' : 'text-slate-700 dark:text-slate-300'}`}>
                    All Tags
                  </Text>
                </TouchableOpacity>
                {tagOptions.map((tag) => (
                  <TouchableOpacity
                    key={tag}
                    onPress={() => setSelectedTag(tag)}
                    className={`${isVerySmall ? 'px-3 py-1.5' : 'px-4 py-2'} rounded-xl border-2 mr-2 ${selectedTag.toLowerCase() === tag.toLowerCase() ? 'bg-cyan-50 dark:bg-cyan-900/20 border-cyan-500' : 'bg-slate-50 dark:bg-slate-900 border-transparent'}`}
                  >
                    <Text className={`font-bold ${filterChipTextSize} ${selectedTag.toLowerCase() === tag.toLowerCase() ? 'text-cyan-600 dark:text-cyan-400' : 'text-slate-700 dark:text-slate-300'}`}>
                      #{tag}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>
        ) : null}

        <View className={`bg-white dark:bg-slate-800 rounded-3xl ${isVerySmall ? 'p-4' : 'p-6'} mb-6 shadow-lg border border-slate-100 dark:border-slate-700`} style={{ elevation: 4 }}>
          <Text className={`text-slate-900 dark:text-white font-bold ${sectionTitleSize} mb-3`}>Format</Text>
          <View className="flex-row">
            <TouchableOpacity
              onPress={() => setSelectedFormat('excel')}
              className={`flex-1 mr-2 rounded-2xl border-2 ${cardPaddingClass} ${selectedFormat === 'excel' ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-500' : 'bg-slate-50 dark:bg-slate-900 border-transparent'}`}
            >
              <Text className={`text-center font-bold ${actionTextSize} ${selectedFormat === 'excel' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-300'}`}>
                Excel
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => selectedType !== 'all_data' && setSelectedFormat('pdf')}
              disabled={selectedType === 'all_data'}
              className={`flex-1 ml-2 rounded-2xl border-2 ${cardPaddingClass} ${selectedFormat === 'pdf' ? 'bg-red-50 dark:bg-red-900/20 border-red-500' : 'bg-slate-50 dark:bg-slate-900 border-transparent'} ${selectedType === 'all_data' ? 'opacity-40' : ''}`}
            >
              <Text className={`text-center font-bold ${actionTextSize} ${selectedFormat === 'pdf' ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-300'}`}>
                PDF
              </Text>
            </TouchableOpacity>
          </View>
          {selectedType === 'all_data' ? (
            <Text className="text-slate-500 text-xs mt-3">All Data export supports Excel only.</Text>
          ) : null}
        </View>

        <View className={`bg-white dark:bg-slate-800 rounded-3xl ${isVerySmall ? 'p-4' : 'p-6'} mb-6 shadow-lg border border-slate-100 dark:border-slate-700`} style={{ elevation: 4 }}>
          <Text className={`text-slate-900 dark:text-white font-bold ${sectionTitleSize} mb-2`}>Preview</Text>
          <Text className={`text-slate-600 dark:text-slate-300 ${helperTextSize}`}>{previewLabel}</Text>
        </View>

        <TouchableOpacity
          onPress={() => { void handleExport(); }}
          disabled={!canExport || isExporting}
          className={`rounded-3xl ${isVerySmall ? 'p-4' : 'p-5'} mb-8 flex-row justify-center items-center ${!canExport || isExporting ? 'bg-slate-300 dark:bg-slate-700' : 'bg-sky-600'}`}
        >
          {isExporting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <FontAwesome name="download" size={isVerySmall ? 16 : 18} color="#fff" />
              <Text className={`text-white font-bold ${actionTextSize} ml-2`}>Export Now</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}
