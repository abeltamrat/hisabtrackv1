import AIInsights from '@/components/AIInsights';
import { CATEGORIES } from '@/constants/MockData';
import { useAppSettings } from '@/contexts/AppSettingsContext';
import { useI18n } from '@/contexts/I18nContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import ExportService from '@/services/ExportService';
import ForecastService, { ForecastEvent } from '@/services/ForecastService';
import LocalChangeEmitter from '@/services/LocalChangeEmitter';
import { SMSSyncService } from '@/services/SMSSyncService';
import SyncService from '@/services/SyncService';
import { getDatabase } from '@/services/database';
import { AppDispatch, RootState } from '@/store';
import { fetchAccounts } from '@/store/slices/accountsSlice';
import { fetchBudgets } from '@/store/slices/budgetsSlice';
import { fetchLoans } from '@/store/slices/loansSlice';
import { fetchTransactions } from '@/store/slices/transactionsSlice';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { RecurringTransaction } from '@/types/database';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Dimensions, Platform, ScrollView, Text, TouchableOpacity, View, Modal } from 'react-native';
import { BarChart, LineChart, PieChart, ProgressChart } from 'react-native-chart-kit';

import { useDispatch, useSelector } from 'react-redux';

const screenWidth = Dimensions.get('window').width;

type TimeRange = 'week' | 'month' | 'year' | 'all';
type ReportTab = 'overview' | 'income' | 'expense' | 'trends' | 'comparison' | 'forecast';

import { useRouter } from 'expo-router';

const FORECAST_HORIZONS: Array<{ value: 7 | 30 | 90; label: string }> = [
  { value: 7, label: '7D' },
  { value: 30, label: '30D' },
  { value: 90, label: '90D' },
];

const getForecastEventIcon = (event: ForecastEvent) => {
  switch (event.type) {
    case 'INCOME':
      return 'arrow-up';
    case 'EXPENSE':
      return 'arrow-down';
    case 'TRANSFER':
      return 'exchange';
    case 'LOAN_DUE':
      return 'credit-card';
    default:
      return 'calendar';
  }
};

const getForecastEventColor = (event: ForecastEvent) => {
  switch (event.type) {
    case 'INCOME':
      return '#16a34a';
    case 'EXPENSE':
      return '#dc2626';
    case 'TRANSFER':
      return '#2563eb';
    case 'LOAN_DUE':
      return '#ea580c';
    default:
      return '#64748b';
  }
};

export default function ReportsScreen() {
  const router = useRouter();
  const dispatch = useDispatch<AppDispatch>();
  const { user } = useAuth();
  const transactions = useSelector((s: RootState) => s.transactions.items);
  const budgets = useSelector((s: RootState) => s.budgets.items);
  const loans = useSelector((s: RootState) => s.loans.items);
  const accounts = useSelector((s: RootState) => s.accounts.items);
  const [recurring, setRecurring] = useState<RecurringTransaction[]>([]);
  const [forecastDays, setForecastDays] = useState<7 | 30 | 90>(30);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isExportModalVisible, setExportModalVisible] = useState(false);
  const [selectedReportType, setSelectedReportType] = useState<'transactions' | 'summary' | 'loans' | 'all_data'>('transactions');
  const [exportStep, setExportStep] = useState<1 | 2>(1);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    // Load budgets, loans and transactions if not already loaded or to ensure fresh data
    dispatch(fetchBudgets());
    dispatch(fetchLoans());
    dispatch(fetchTransactions());
    dispatch(fetchAccounts());
    void loadRecurring();

    const unsubscribe = LocalChangeEmitter.subscribe(async () => {
      await loadRecurring();
    });

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [dispatch]);

  const loadRecurring = async () => {
    try {
      const stored = Platform.OS === 'web'
        ? localStorage.getItem('recurring_transactions')
        : await AsyncStorage.getItem('@hisabtrack_recurring_transactions');
      if (stored) setRecurring(JSON.parse(stored));
    } catch (e) {
      console.error('Error loading recurring in reports:', e);
    }
  };

  const handleManualSync = async () => {
    setIsSyncing(true);
    try {
      const syncResult = await SyncService.syncNow(user?.uid);

      if (Platform.OS === 'android') {
        console.log('[Reports] Triggering SMS sync...');
        const db = await getDatabase();
        const latestAccounts = await db.getAccounts();
        const latestTransactions = await db.getTransactions();
        await SMSSyncService.checkAllNow(latestAccounts, latestTransactions);
        await SyncService.refreshLocalStore();
      }

      const message = syncResult.cloudSynced
        ? Platform.OS === 'android'
          ? 'Refresh complete. Local, cloud, and SMS data are synchronized.'
          : 'Refresh complete. Local and cloud data are synchronized.'
        : Platform.OS === 'android'
          ? 'Refresh complete. Local data refreshed and SMS checked.'
          : 'Refresh complete. Local data refreshed.';

      if (Platform.OS === 'web') {
        // Use toast or similar if available, otherwise silent or alert
      } else {
        Alert.alert('Success', message);
      }
    } catch (err) {
      console.error('Manual refresh failed:', err);
      if (Platform.OS !== 'web') {
        Alert.alert('Error', 'Failed to refresh data. Please check your connection.');
      }
    } finally {
      setIsSyncing(false);
    }
  };

  const handleExport = async (format: 'pdf' | 'excel') => {
    const hasExportData = selectedReportType === 'all_data'
      ? accounts.length > 0 || transactions.length > 0 || budgets.length > 0 || loans.length > 0
      : selectedReportType === 'loans'
        ? loans.length > 0
        : filteredTransactions.length > 0;

    if (!hasExportData) {
      Alert.alert('No Data', selectedReportType === 'all_data'
        ? 'There is no account, transaction, budget, or loan data to export.'
        : 'There are no transactions in the selected period to export.'
      );
      return;
    }

    if (selectedReportType === 'all_data' && format === 'pdf') {
      Alert.alert('Excel only', 'All-data export is available in Excel format only.');
      return;
    }

    setExportModalVisible(false);
    setIsExporting(true);

    // Give the modal time to close visually
    setTimeout(async () => {
      try {
        const exportData = selectedReportType === 'all_data' ? transactions : filteredTransactions;
        const exportSummary = selectedReportType === 'all_data' ? undefined : summary;
        const exportTitle = selectedReportType === 'all_data'
          ? 'Complete Financial Backup'
          : format === 'pdf'
            ? `Financial ${selectedReportType.charAt(0).toUpperCase() + selectedReportType.slice(1)} Report`
            : 'Financial Report';
        const exportTimeRange = selectedReportType === 'all_data' ? 'All Time' : timeRange;

        await ExportService.exportReport({
          data: exportData,
          accounts,
          budgets,
          loans: loans,
          summary: exportSummary,
          title: exportTitle,
          type: selectedReportType,
          format,
          timeRange: exportTimeRange
        });
      } catch (e) {
        console.error('Export failed:', e);
        Alert.alert('Export Failed', 'An error occurred while generating your report.');
      } finally {
        setIsExporting(false);
        setExportStep(1);
      }
    }, 500);
  };
  // Derive categories primarily from Redux transactions, fallback to static defaults
  const categories = useMemo(() => {
    const fallback = CATEGORIES as unknown as any[];
    const collected = new Map<string, any>();

    // Start with fallback to preserve stable colors
    fallback.forEach((c) => collected.set(c.name, c));

    transactions.forEach((t) => {
      const name = (t as any).category || fallback.find(c => c.id === (t as any).categoryId)?.name;
      if (!name) return;
      if (!collected.has(name)) {
        const match = fallback.find(c => c.name === name) || fallback.find(c => c.id === (t as any).categoryId);
        collected.set(name, {
          id: (t as any).categoryId || name,
          name,
          color: match?.color || '#a0a0a0',
          type: (t.type || '').toString().toUpperCase() === 'INCOME' ? 'INCOME' : 'EXPENSE',
        });
      }
    });

    return Array.from(collected.values());
  }, [transactions]);
  const [timeRange, setTimeRange] = useState<TimeRange>('month');
  const [activeTab, setActiveTab] = useState<ReportTab>('overview');
  const { t } = useI18n();
  const { fontSize, formatCurrency } = useAppSettings();
  const { actualTheme } = useTheme();
  const isVerySmall = fontSize === 'V.Small';
  const headerTitleSize = fontSize === 'V.Small' ? 'text-lg' : fontSize === 'Small' ? 'text-xl' : fontSize === 'Large' ? 'text-3xl' : 'text-2xl';
  const sectionTitleSize = fontSize === 'V.Small' ? 'text-sm' : fontSize === 'Small' ? 'text-base' : fontSize === 'Large' ? 'text-xl' : 'text-lg';
  const iconButtonClass = `${isVerySmall ? 'w-9 h-9' : 'w-10 h-10'} bg-white/20 rounded-xl justify-center items-center`;
  const timeRangeButtonClass = `flex-1 ${isVerySmall ? 'py-1' : 'py-1.5'} rounded-lg`;
  const timeRangeTextClass = isVerySmall ? 'text-[11px]' : 'text-xs';
  const tabButtonClass = `${isVerySmall ? 'px-2.5 py-1' : 'px-3 py-1.5'} rounded-lg flex-row items-center`;
  const tabLabelClass = `${isVerySmall ? 'text-[11px]' : 'text-xs'} ml-1.5 font-semibold`;
  const expenseDatasetColor = (opacity = 1) => actualTheme === 'dark' ? `rgba(239, 68, 68, ${opacity})` : `rgba(239, 68, 68, ${opacity})`;
  const incomeDatasetColor = (opacity = 1) => actualTheme === 'dark' ? `rgba(16, 185, 129, ${opacity})` : `rgba(16, 185, 129, ${opacity})`;

  // Filter transactions by time range
  const filteredTransactions = useMemo(() => {
    const now = new Date();
    return transactions.filter(t => {
      const transactionDate = new Date(t.date);
      switch (timeRange) {
        case 'week':
          const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          return transactionDate >= weekAgo;
        case 'month':
          const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
          return transactionDate >= monthAgo;
        case 'year':
          const yearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
          return transactionDate >= yearAgo;
        default:
          return true;
      }
    });
  }, [transactions, timeRange]);

  // Calculate transactions for the previous period for MoM analysis
  const previousPeriodTransactions = useMemo(() => {
    const now = new Date();
    return transactions.filter(t => {
      const transactionDate = new Date(t.date);
      switch (timeRange) {
        case 'week':
          const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
          return transactionDate >= twoWeeksAgo && transactionDate < weekAgo;
        case 'month':
          const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
          const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, now.getDate());
          return transactionDate >= twoMonthsAgo && transactionDate < monthAgo;
        case 'year':
          const yearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
          const twoYearsAgo = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate());
          return transactionDate >= twoYearsAgo && transactionDate < yearAgo;
        default:
          return false;
      }
    });
  }, [transactions, timeRange]);

  // Calculate summary statistics
  const summary = useMemo(() => {
    const income = filteredTransactions
      .filter(t => (t.type || '').toString().toUpperCase() === 'INCOME')
      .reduce((sum, t) => sum + (t.amount || 0), 0);

    const expense = filteredTransactions
      .filter(t => (t.type || '').toString().toUpperCase() === 'EXPENSE')
      .reduce((sum, t) => sum + (t.amount || 0), 0);

    const balance = income - expense;
    const savingsRate = income > 0 ? ((income - expense) / income) * 100 : 0;
    let days: number;
    if (timeRange === 'week') days = 7;
    else if (timeRange === 'month') days = 30;
    else if (timeRange === 'year') days = 365;
    else {
      const oldest = filteredTransactions.length > 0
        ? Math.min(...filteredTransactions.map(t => t.date))
        : Date.now();
      days = Math.max(1, Math.ceil((Date.now() - oldest) / (1000 * 60 * 60 * 24)));
    }
    const avgDailyExpense = expense / days;

    return {
      income,
      expense,
      balance,
      savingsRate,
      avgDailyExpense,
      transactionCount: filteredTransactions.length,
    };
  }, [filteredTransactions, timeRange]);

  // Monthly Aggregation for Analysis
  const monthlyData = useMemo(() => {
    const data: Record<string, { income: number; expense: number; date: Date }> = {};
    // Use ALL transactions for historical analysis
    transactions.forEach(t => {
      const d = new Date(typeof t.date === 'number' ? t.date : new Date(t.date).getTime());
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (!data[key]) data[key] = { income: 0, expense: 0, date: new Date(d.getFullYear(), d.getMonth(), 1) };

      if ((t.type || '').toString().toUpperCase() === 'INCOME') data[key].income += (t.amount || 0);
      else if ((t.type || '').toString().toUpperCase() === 'EXPENSE') data[key].expense += (t.amount || 0);
    });

    return Object.values(data).sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [transactions]);

  // Analysis Stats
  const analysisStats = useMemo(() => {
    let maxIncome = { amount: 0, month: 'N/A' };
    let minIncome = { amount: Infinity, month: 'N/A' };
    let maxExpense = { amount: 0, month: 'N/A' };
    let minExpense = { amount: Infinity, month: 'N/A' };
    let totalExpense = 0;

    // Filter out incomplete current month if needed, but for now include all
    const validMonths = monthlyData.length;

    monthlyData.forEach(m => {
      const monthStr = m.date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

      if (m.income > maxIncome.amount) maxIncome = { amount: m.income, month: monthStr };
      if (m.income < minIncome.amount && m.income > 0) minIncome = { amount: m.income, month: monthStr };

      if (m.expense > maxExpense.amount) maxExpense = { amount: m.expense, month: monthStr };
      if (m.expense < minExpense.amount && m.expense > 0) minExpense = { amount: m.expense, month: monthStr };

      totalExpense += m.expense;
    });

    if (minIncome.amount === Infinity) minIncome = { amount: 0, month: 'N/A' };
    if (minExpense.amount === Infinity) minExpense = { amount: 0, month: 'N/A' };

    const avgMonthlyExpense = validMonths > 0 ? totalExpense / validMonths : 0;

    return { maxIncome, minIncome, maxExpense, minExpense, avgMonthlyExpense };
  }, [monthlyData]);

  // Historical reference (avg of last 3 months)
  const historicalForecast = useMemo(() => {
    const last3 = monthlyData.slice(-3);
    if (last3.length === 0) return { income: 0, expense: 0 };
    const avgInc = last3.reduce((s, m) => s + m.income, 0) / last3.length;
    const avgExp = last3.reduce((s, m) => s + m.expense, 0) / last3.length;
    return { income: avgInc, expense: avgExp };
  }, [monthlyData]);

  const accountsById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts]
  );

  const forecastResult = useMemo(
    () =>
      ForecastService.generateForecast({
        accounts,
        recurring,
        loans,
        days: forecastDays,
      }),
    [accounts, recurring, loans, forecastDays]
  );

  const forecastChart = useMemo(() => {
    if (forecastResult.snapshots.length === 0) {
      return null;
    }

    const labelEvery = Math.max(1, Math.floor(forecastResult.snapshots.length / 5));

    return {
      labels: forecastResult.snapshots.map((snapshot, index) => {
        if (
          index === 0 ||
          index === forecastResult.snapshots.length - 1 ||
          index % labelEvery === 0
        ) {
          return new Date(snapshot.date).toLocaleDateString('en-US', {
            month: forecastDays === 90 ? 'short' : undefined,
            day: 'numeric',
          });
        }

        return '';
      }),
      datasets: [
        {
          data: forecastResult.snapshots.map((snapshot) => snapshot.totalBalance),
          color: (opacity = 1) => `rgba(79, 70, 229, ${opacity})`,
          strokeWidth: 3,
        },
      ],
    };
  }, [forecastDays, forecastResult.snapshots]);

  const nextForecastEvents = useMemo(
    () => forecastResult.events.slice(0, 6),
    [forecastResult.events]
  );

  // Category-wise breakdown
  const categoryBreakdown = useMemo(() => {
    const expenseTransactions = filteredTransactions.filter(t => (t.type || '').toString().toUpperCase() === 'EXPENSE');
    const categoryTotals: { [key: string]: number } = {};

    expenseTransactions.forEach(transaction => {
      // support both `category` (string) and `categoryId` (id from mock categories)
      const catName = (transaction as any).category || categories.find(c => c.id === (transaction as any).categoryId)?.name || 'Unknown';
      if (!categoryTotals[catName]) {
        categoryTotals[catName] = 0;
      }
      categoryTotals[catName] += (transaction.amount || 0);
    });

    return Object.entries(categoryTotals)
      .map(([catName, total]) => {
        const category = categories.find(c => c.name === catName);
        return {
          id: category?.id || catName,
          name: catName,
          amount: total,
          color: category?.color || '#a0a0a0', // Fallback color
          percentage: summary.expense > 0 ? (total / summary.expense) * 100 : 0,
          legendFontColor: '#64748b',
          legendFontSize: 12,
        };
      })
      .sort((a, b) => b.amount - a.amount);
  }, [filteredTransactions, categories, summary.expense]);

  // Income sources breakdown
  const incomeBreakdown = useMemo(() => {
    const incomeTransactions = filteredTransactions.filter(t => (t.type || '').toString().toUpperCase() === 'INCOME');
    const categoryTotals: { [key: string]: number } = {};

    incomeTransactions.forEach(transaction => {
      const catName = (transaction as any).category || categories.find(c => c.id === (transaction as any).categoryId)?.name || 'Unknown';
      if (!categoryTotals[catName]) {
        categoryTotals[catName] = 0;
      }
      categoryTotals[catName] += (transaction.amount || 0);
    });

    return Object.entries(categoryTotals)
      .map(([catName, total]) => {
        const category = categories.find(c => c.name === catName);
        return {
          id: category?.id || catName,
          name: catName,
          amount: total,
          color: category?.color || '#10b981',
          percentage: summary.income > 0 ? (total / summary.income) * 100 : 0,
        };
      })
      .sort((a, b) => b.amount - a.amount);
  }, [filteredTransactions, categories, summary.income]);

  // Daily trend data
  const dailyTrend = useMemo(() => {
    const days = timeRange === 'week' ? 7 : timeRange === 'month' ? 30 : 12;
    const data = Array.from({ length: days }, (_, i) => {
      const date = new Date();
      if (timeRange === 'year') {
        date.setMonth(date.getMonth() - (days - 1 - i));
      } else {
        date.setDate(date.getDate() - (days - 1 - i));
      }
      return {
        date,
        label: timeRange === 'year'
          ? date.toLocaleDateString('en-US', { month: 'short' })
          : date.getDate().toString(),
        income: 0,
        expense: 0,
      };
    });

    filteredTransactions.forEach(transaction => {
      const tDate = new Date(typeof transaction.date === 'number' ? transaction.date : new Date(transaction.date).getTime());
      const index = data.findIndex(d => {
        if (timeRange === 'year') {
          return d.date.getMonth() === tDate.getMonth() &&
            d.date.getFullYear() === tDate.getFullYear();
        } else {
          return d.date.toDateString() === tDate.toDateString();
        }
      });

      if (index !== -1) {
        if ((transaction.type || '').toString().toUpperCase() === 'INCOME') {
          data[index].income += (transaction.amount || 0);
        } else if ((transaction.type || '').toString().toUpperCase() === 'EXPENSE') {
          data[index].expense += (transaction.amount || 0);
        }
      }
    });

    return data;
  }, [filteredTransactions, timeRange]);

  const chartConfig = {
    backgroundColor: actualTheme === 'dark' ? '#0f172a' : '#ffffff',
    backgroundGradientFrom: actualTheme === 'dark' ? '#0f172a' : '#ffffff',
    backgroundGradientTo: actualTheme === 'dark' ? '#0f172a' : '#ffffff',
    decimalPlaces: 0,
    color: (opacity = 1) => actualTheme === 'dark' ? `rgba(148, 163, 184, ${opacity})` : `rgba(99, 102, 241, ${opacity})`,
    labelColor: (opacity = 1) => actualTheme === 'dark' ? `rgba(226, 232, 240, ${opacity})` : `rgba(100, 116, 139, ${opacity})`,
    style: { borderRadius: 16 },
    propsForDots: { r: '4', strokeWidth: '2', stroke: actualTheme === 'dark' ? '#94a3b8' : '#6366f1' },
  };

  const timeRanges: { value: TimeRange; label: string }[] = [
    { value: 'week', label: 'Week' },
    { value: 'month', label: 'Month' },
    { value: 'year', label: 'Year' },
    { value: 'all', label: 'All' },
  ];

  const tabs: { value: ReportTab; label: string; icon: string }[] = [
    { value: 'overview', label: 'Overview', icon: 'dashboard' },
    { value: 'forecast', label: 'Forecast', icon: 'line-chart' },
    { value: 'income', label: 'Income', icon: 'arrow-up' },
    { value: 'expense', label: 'Expense', icon: 'arrow-down' },
    { value: 'trends', label: 'Trends', icon: 'line-chart' },
    { value: 'comparison', label: 'Compare', icon: 'exchange' },
  ];

  return (
    <View className="flex-1 bg-slate-50 dark:bg-background-dark">
      <StatusBar style="auto" />

      {/* Header */}
      <LinearGradient
        colors={['#6366f1', '#4f46e5']}
        className="px-6 pt-12 pb-8 rounded-b-[32px]"
        style={{ elevation: 4 }}
      >
        <View className="flex-row justify-between items-center mb-6">
          <Text className={`text-white font-bold ${headerTitleSize}`}>{t('reports.title')}</Text>
          <View className="flex-row gap-2">
            <TouchableOpacity
              onPress={() => router.push('/aiassistant')}
              className={iconButtonClass}
            >
              <FontAwesome name="magic" size={isVerySmall ? 16 : 18} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleManualSync}
              disabled={isSyncing}
              className={iconButtonClass}
            >
              <FontAwesome name={isSyncing ? "spinner" : "refresh"} size={isVerySmall ? 16 : 18} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setExportModalVisible(true)}
              disabled={isExporting}
              className={iconButtonClass}
            >
              <FontAwesome name={isExporting ? "spinner" : "download"} size={isVerySmall ? 16 : 18} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
        {/* Time Range Selector */}
        <View className="flex-row gap-2">
          {timeRanges.map((range) => (
            <TouchableOpacity
              key={range.value}
              onPress={() => setTimeRange(range.value)}
              className={`${timeRangeButtonClass} ${timeRange === range.value
                ? 'bg-white'
                : 'bg-white/20'
                }`}
            >
              <Text
                className={`text-center font-semibold ${timeRangeTextClass} ${timeRange === range.value
                  ? 'text-indigo-600'
                  : 'text-white'
                  }`}
              >
                {range.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </LinearGradient >

      {/* Tab Navigation */}
      < View className="px-6 pb-0" style={{ marginTop: 0 }
      }>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          {tabs.map((tab) => (
            <TouchableOpacity
              key={tab.value}
              onPress={() => setActiveTab(tab.value)}
              className={`${tabButtonClass} ${activeTab === tab.value
                ? 'bg-indigo-500'
                : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700'
                }`}
            >
              <FontAwesome
                name={tab.icon as any}
                size={isVerySmall ? 11 : 12}
                color={activeTab === tab.value ? '#fff' : '#64748b'}
              />
              <Text
                className={`${tabLabelClass} ${activeTab === tab.value
                  ? 'text-white'
                  : 'text-slate-600 dark:text-slate-400'
                  }`}
              >
                {t(tab.label.toLowerCase())}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View >

      <ScrollView className="flex-1 px-6 mt-4" showsVerticalScrollIndicator={false}>
        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <View>
            {/* Summary Cards */}
            <View className="flex-row gap-3 mb-6">
              <View className="flex-1 bg-green-50 dark:bg-green-900/20 p-4 rounded-2xl border-2 border-green-200 dark:border-green-800">
                <Text className="text-green-600 text-xs font-bold mb-1">{t('income').toUpperCase()}</Text>
                <Text className="text-green-700 dark:text-green-400 text-2xl font-bold">
                  {formatCurrency(summary.income)}
                </Text>
              </View>
              <View className="flex-1 bg-red-50 dark:bg-red-900/20 p-4 rounded-2xl border-2 border-red-200 dark:border-red-800">
                <Text className="text-red-600 text-xs font-bold mb-1">{t('expense').toUpperCase()}</Text>
                <Text className="text-red-700 dark:text-red-400 text-2xl font-bold">
                  {formatCurrency(summary.expense)}
                </Text>
              </View>
            </View>

            <View className="flex-row gap-3 mb-6">
              <View className="flex-1 bg-blue-50 dark:bg-blue-900/20 p-4 rounded-2xl border-2 border-blue-200 dark:border-blue-800">
                <Text className="text-blue-600 text-xs font-bold mb-1">{t('netBalance') || 'NET BALANCE'}</Text>
                <Text className={`text-2xl font-bold ${summary.balance >= 0 ? 'text-green-600' : 'text-red-600'
                  }`}>
                  {formatCurrency(Math.abs(summary.balance))}
                </Text>
              </View>
              <View className="flex-1 bg-purple-50 dark:bg-purple-900/20 p-4 rounded-2xl border-2 border-purple-200 dark:border-purple-800">
                <Text className="text-purple-600 text-xs font-bold mb-1">{t('savingsRateLabel') || 'SAVINGS RATE'}</Text>
                <Text className="text-purple-700 dark:text-purple-400 text-2xl font-bold">
                  {summary.savingsRate.toFixed(1)}%
                </Text>
              </View>
            </View>

            {/* AI Financial Insights */}
            {/* AI Financial Insights */}
            <AIInsights
              transactions={filteredTransactions}
              previousPeriodTransactions={previousPeriodTransactions}
              budgets={budgets}
              loans={loans}
              recurring={recurring}
            />

            {/* Additional Stats */}
            <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-slate-100 dark:border-slate-700">
              <Text className={`text-slate-900 dark:text-white ${sectionTitleSize} font-bold mb-4`}>{t('quickStats')}</Text>

              <View className="flex-row justify-between mb-3">
                <Text className="text-slate-600 dark:text-slate-400">{t('totalTransactions')}</Text>
                <Text className="text-slate-900 dark:text-white font-bold">{summary.transactionCount}</Text>
              </View>

              <View className="flex-row justify-between mb-3">
                <Text className="text-slate-600 dark:text-slate-400">{t('avgDailyExpense')}</Text>
                <Text className="text-slate-900 dark:text-white font-bold">{formatCurrency(summary.avgDailyExpense)}</Text>
              </View>

              <View className="flex-row justify-between">
                <Text className="text-slate-600 dark:text-slate-400">{t('topCategory')}</Text>
                <Text className="text-slate-900 dark:text-white font-bold">{categoryBreakdown[0]?.name || 'N/A'}</Text>
              </View>
            </View>

            {/* Expense Pie Chart */}
            {categoryBreakdown.length > 0 && (
              <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-slate-100 dark:border-slate-700">
                <Text className={`text-slate-900 dark:text-white ${sectionTitleSize} font-bold mb-4`}>
                  {t('expenseDistribution')}
                </Text>
                <PieChart
                  data={categoryBreakdown.slice(0, 6)}
                  width={screenWidth - 80}
                  height={220}
                  chartConfig={chartConfig}
                  accessor="amount"
                  backgroundColor="transparent"
                  paddingLeft="15"
                  absolute
                />
              </View>
            )}
          </View>
        )}

        {/* Forecast Tab */}
        {activeTab === 'forecast' && (
          <View>
            <View className="flex-row gap-2 mb-4">
              {FORECAST_HORIZONS.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  onPress={() => setForecastDays(option.value)}
                  className={`flex-1 ${isVerySmall ? 'py-2.5' : 'py-3'} rounded-2xl border ${
                    forecastDays === option.value
                      ? 'bg-indigo-500 border-indigo-500'
                      : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <Text
                    className={`text-center font-bold ${isVerySmall ? 'text-xs' : 'text-sm'} ${
                      forecastDays === option.value
                        ? 'text-white'
                        : 'text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <LinearGradient colors={['#1d4ed8', '#4338ca']} className="rounded-3xl p-6 mb-6 shadow-lg">
              <View className="flex-row justify-between items-start mb-5">
                <View className="flex-1 pr-4">
                  <Text className="text-white/80 font-bold mb-1">Cashflow Forecast</Text>
                  <Text className="text-white/70 text-sm">
                    Next {forecastDays} days from current balances, recurring activity, and active debt due dates.
                  </Text>
                </View>
                <View className="items-end">
                  <Text className="text-white/60 text-xs">Projected Change</Text>
                  <Text
                    className={`text-xl font-bold ${
                      forecastResult.projectedBalance - forecastResult.startingBalance >= 0
                        ? 'text-emerald-200'
                        : 'text-rose-200'
                    }`}
                  >
                    {formatCurrency(forecastResult.projectedBalance - forecastResult.startingBalance)}
                  </Text>
                </View>
              </View>

              <View className="flex-row gap-3">
                <View className="flex-1 bg-white/10 rounded-2xl p-4">
                  <Text className="text-white/60 text-xs mb-1">Current Balance</Text>
                  <Text className="text-white text-2xl font-bold">{formatCurrency(forecastResult.startingBalance)}</Text>
                </View>
                <View className="flex-1 bg-white/10 rounded-2xl p-4">
                  <Text className="text-white/60 text-xs mb-1">Projected Balance</Text>
                  <Text className="text-white text-2xl font-bold">{formatCurrency(forecastResult.projectedBalance)}</Text>
                </View>
              </View>

              <View
                className="mt-4 pt-4 flex-row justify-between items-end"
                style={{ borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.18)' }}
              >
                <View>
                  <Text className="text-white/60 text-xs mb-1">Lowest Balance</Text>
                  <Text className="text-white text-xl font-bold">{formatCurrency(forecastResult.lowestBalance)}</Text>
                </View>
                <View className="items-end">
                  <Text className="text-white/60 text-xs mb-1">Lowest Date</Text>
                  <Text className="text-white font-semibold">
                    {forecastResult.lowestBalanceDate
                      ? new Date(forecastResult.lowestBalanceDate).toLocaleDateString()
                      : 'N/A'}
                  </Text>
                </View>
              </View>
            </LinearGradient>

            <View className="flex-row gap-3 mb-6">
              <View className="flex-1 bg-emerald-50 dark:bg-emerald-900/20 p-4 rounded-2xl border border-emerald-200 dark:border-emerald-800">
                <Text className="text-emerald-600 text-xs font-bold mb-1">Expected Income</Text>
                <Text className="text-emerald-700 dark:text-emerald-300 text-xl font-bold">
                  {formatCurrency(forecastResult.upcomingIncome)}
                </Text>
              </View>
              <View className="flex-1 bg-orange-50 dark:bg-orange-900/20 p-4 rounded-2xl border border-orange-200 dark:border-orange-800">
                <Text className="text-orange-600 text-xs font-bold mb-1">Scheduled Outflows</Text>
                <Text className="text-orange-700 dark:text-orange-300 text-xl font-bold">
                  {formatCurrency(forecastResult.upcomingExpense + forecastResult.upcomingLoanPayments)}
                </Text>
              </View>
            </View>

            {forecastResult.upcomingLoanPayments > 0 && (
              <View className="bg-amber-50 dark:bg-amber-900/10 rounded-2xl p-4 mb-6 border border-amber-200 dark:border-amber-800">
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center flex-1 pr-4">
                    <View className="w-10 h-10 rounded-full bg-amber-500/15 items-center justify-center mr-3">
                      <FontAwesome name="credit-card" size={16} color="#d97706" />
                    </View>
                    <View className="flex-1">
                      <Text className="text-amber-800 dark:text-amber-200 font-bold">Loan Payments Due</Text>
                      <Text className="text-amber-700/80 dark:text-amber-100/70 text-xs">
                        Active borrowed loans reduce projected available cash in this horizon.
                      </Text>
                    </View>
                  </View>
                  <Text className="text-amber-700 dark:text-amber-300 font-bold text-lg">
                    {formatCurrency(forecastResult.upcomingLoanPayments)}
                  </Text>
                </View>
              </View>
            )}

            <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-slate-100 dark:border-slate-700">
              <Text className={`text-slate-900 dark:text-white ${sectionTitleSize} font-bold mb-4`}>
                Projected Balance Curve
              </Text>
              {forecastChart && forecastChart.datasets[0].data.length > 1 ? (
                <LineChart
                  data={forecastChart}
                  width={screenWidth - 80}
                  height={220}
                  yAxisSuffix="$"
                  chartConfig={{
                    ...chartConfig,
                    color: (opacity = 1) => `rgba(79, 70, 229, ${opacity})`,
                  }}
                  bezier
                  style={{ borderRadius: 16 }}
                />
              ) : (
                <View className="items-center justify-center py-10">
                  <FontAwesome name="line-chart" size={48} color="#cbd5e1" />
                  <Text className="text-slate-400 mt-4">Not enough scheduled activity to draw a forecast yet.</Text>
                </View>
              )}
            </View>

            <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-slate-100 dark:border-slate-700">
              <Text className={`text-slate-900 dark:text-white ${sectionTitleSize} font-bold mb-4`}>
                Upcoming Forecast Events
              </Text>
              {nextForecastEvents.length > 0 ? (
                nextForecastEvents.map((event) => {
                  const color = getForecastEventColor(event);
                  const accountLabel = event.type === 'TRANSFER'
                    ? `${accountsById.get(event.accountId || '')?.name || 'Missing account'} -> ${accountsById.get(event.toAccountId || '')?.name || 'Missing account'}`
                    : event.type === 'LOAN_DUE'
                      ? 'Borrowed loan due'
                      : accountsById.get(event.accountId || '')?.name || event.category;

                  return (
                    <View
                      key={event.id}
                      className="flex-row items-center justify-between py-3 border-b border-slate-100 dark:border-slate-700/70"
                    >
                      <View className="flex-row items-center flex-1 pr-4">
                        <View
                          className="w-10 h-10 rounded-full items-center justify-center mr-3"
                          style={{ backgroundColor: `${color}20` }}
                        >
                          <FontAwesome name={getForecastEventIcon(event) as any} size={16} color={color} />
                        </View>
                        <View className="flex-1">
                          <Text className="text-slate-900 dark:text-white font-bold" numberOfLines={1}>
                            {event.title}
                          </Text>
                          <Text className="text-slate-500 dark:text-slate-400 text-xs">
                            {new Date(event.date).toLocaleDateString()} • {accountLabel}
                          </Text>
                        </View>
                      </View>
                      <View className="items-end">
                        <Text className="font-bold" style={{ color }}>
                          {event.type === 'INCOME' ? '+' : event.type === 'TRANSFER' ? '' : '-'}
                          {formatCurrency(event.amount)}
                        </Text>
                        <Text className="text-slate-400 text-xs">
                          Bal: {formatCurrency(event.balanceAfter ?? forecastResult.startingBalance)}
                        </Text>
                      </View>
                    </View>
                  );
                })
              ) : (
                <Text className="text-slate-400 text-center py-8">
                  No recurring transactions or due loan payments fall within this horizon.
                </Text>
              )}
            </View>

            <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-slate-100 dark:border-slate-700">
              <Text className={`text-slate-900 dark:text-white ${sectionTitleSize} font-bold mb-4`}>
                Largest Upcoming Outflows
              </Text>
              {forecastResult.largeExpenses.length > 0 ? (
                forecastResult.largeExpenses.map((event, index) => (
                  <View
                    key={`${event.id}-large`}
                    className={`flex-row items-center justify-between ${index < forecastResult.largeExpenses.length - 1 ? 'mb-3' : ''}`}
                  >
                    <View className="flex-1 pr-4">
                      <Text className="text-slate-900 dark:text-white font-bold">{event.title}</Text>
                      <Text className="text-slate-500 dark:text-slate-400 text-xs">
                        {new Date(event.date).toLocaleDateString()} • {event.type === 'LOAN_DUE' ? 'Loan repayment' : event.category}
                      </Text>
                    </View>
                    <Text className="text-red-600 font-bold text-lg">{formatCurrency(event.amount)}</Text>
                  </View>
                ))
              ) : (
                <Text className="text-slate-400 text-center py-8">
                  No major outgoing events are scheduled in the selected forecast window.
                </Text>
              )}
            </View>

            <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-slate-100 dark:border-slate-700">
              <Text className={`text-slate-900 dark:text-white ${sectionTitleSize} font-bold mb-4`}>
                Projected Account Balances
              </Text>
              {forecastResult.accountProjections.length > 0 ? (
                forecastResult.accountProjections.map((projection) => (
                  <View
                    key={projection.accountId}
                    className="flex-row items-center justify-between py-3 border-b border-slate-100 dark:border-slate-700/70"
                  >
                    <View className="flex-1 pr-4">
                      <Text className="text-slate-900 dark:text-white font-bold">
                        {projection.accountName}
                      </Text>
                      <Text className="text-slate-500 dark:text-slate-400 text-xs">
                        {projection.isVirtual
                          ? 'Derived obligation from borrowed loans due in this period.'
                          : `Current ${formatCurrency(projection.currentBalance)} to projected ${formatCurrency(projection.projectedBalance)}`}
                      </Text>
                    </View>
                    <View className="items-end">
                      <Text className="text-slate-900 dark:text-white font-bold text-lg">
                        {formatCurrency(projection.projectedBalance)}
                      </Text>
                      <Text
                        className={`text-xs font-semibold ${
                          projection.delta >= 0 ? 'text-emerald-600' : 'text-red-600'
                        }`}
                      >
                        {projection.delta >= 0 ? '+' : ''}
                        {formatCurrency(projection.delta)}
                      </Text>
                    </View>
                  </View>
                ))
              ) : (
                <Text className="text-slate-400 text-center py-8">
                  Add at least one account to start forecasting balances.
                </Text>
              )}
            </View>

            <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-slate-100 dark:border-slate-700">
              <Text className={`text-slate-900 dark:text-white ${sectionTitleSize} font-bold mb-4`}>
                Historical Reference
              </Text>

              <View className="flex-row gap-3 mb-4">
                <View className="flex-1 bg-green-50 dark:bg-green-900/10 p-4 rounded-2xl">
                  <Text className="text-green-600 text-xs font-bold mb-1">3-Month Avg Income</Text>
                  <Text className="text-green-700 dark:text-green-300 text-lg font-bold">
                    {formatCurrency(historicalForecast.income)}
                  </Text>
                </View>
                <View className="flex-1 bg-red-50 dark:bg-red-900/10 p-4 rounded-2xl">
                  <Text className="text-red-600 text-xs font-bold mb-1">3-Month Avg Expense</Text>
                  <Text className="text-red-700 dark:text-red-300 text-lg font-bold">
                    {formatCurrency(historicalForecast.expense)}
                  </Text>
                </View>
              </View>

              <View className="flex-row justify-between bg-slate-50 dark:bg-slate-900/40 rounded-2xl p-4">
                <View>
                  <Text className="text-slate-500 dark:text-slate-400 text-xs">Avg Monthly Expense</Text>
                  <Text className="text-slate-900 dark:text-white font-bold">{formatCurrency(analysisStats.avgMonthlyExpense)}</Text>
                </View>
                <View className="items-end">
                  <Text className="text-slate-500 dark:text-slate-400 text-xs">Best Income Month</Text>
                  <Text className="text-slate-900 dark:text-white font-bold">{analysisStats.maxIncome.month}</Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* Income Tab */}
        {activeTab === 'income' && (
          <View>
            <LinearGradient colors={['#22c55e', '#16a34a']} className="rounded-3xl p-6 mb-6">
              <Text className="text-white/80 text-sm mb-2">{t('totalIncome')}</Text>
              <Text className="text-white text-4xl font-bold">{formatCurrency(summary.income)}</Text>
            </LinearGradient>

            {incomeBreakdown.map((item, index) => (
              <View
                key={item.id}
                className="bg-white dark:bg-slate-800 rounded-2xl p-4 mb-3 shadow-sm border border-slate-100 dark:border-slate-700"
              >
                <View className="flex-row items-center justify-between mb-2">
                  <View className="flex-row items-center flex-1">
                    <View
                      className="w-10 h-10 rounded-full justify-center items-center mr-3"
                      style={{ backgroundColor: item.color + '20' }}
                    >
                      <FontAwesome name="arrow-up" size={16} color={item.color} />
                    </View>
                    <View className="flex-1">
                      <Text className="text-slate-900 dark:text-white font-bold">{item.name}</Text>
                      <Text className="text-slate-500 text-xs">{item.percentage.toFixed(1)}% of total</Text>
                    </View>
                  </View>
                  <Text className="text-green-600 font-bold text-lg">{formatCurrency(item.amount)}</Text>
                </View>
                <View className="bg-slate-100 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
                  <View
                    className="bg-green-500 h-full"
                    style={{ width: `${item.percentage}%` }}
                  />
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Expense Tab */}
        {activeTab === 'expense' && (
          <View>
            <LinearGradient colors={['#ef4444', '#dc2626']} className="rounded-3xl p-6 mb-6">
              <Text className="text-white/80 text-sm mb-2">{t('totalExpenses')}</Text>
              <Text className="text-white text-4xl font-bold">{formatCurrency(summary.expense)}</Text>
            </LinearGradient>

            {categoryBreakdown.map((item, index) => (
              <View
                key={item.id}
                className="bg-white dark:bg-slate-800 rounded-2xl p-4 mb-3 shadow-sm border border-slate-100 dark:border-slate-700"
              >
                <View className="flex-row items-center justify-between mb-2">
                  <View className="flex-row items-center flex-1">
                    <View
                      className="w-10 h-10 rounded-full justify-center items-center mr-3"
                      style={{ backgroundColor: item.color + '20' }}
                    >
                      <Text className="font-bold text-slate-700">#{index + 1}</Text>
                    </View>
                    <View className="flex-1">
                      <Text className="text-slate-900 dark:text-white font-bold">{item.name}</Text>
                      <Text className="text-slate-500 text-xs">{item.percentage.toFixed(1)}% of total</Text>
                    </View>
                  </View>
                  <Text className="text-red-600 font-bold text-lg">{formatCurrency(item.amount)}</Text>
                </View>
                <View className="bg-slate-100 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
                  <View
                    className="bg-red-500 h-full"
                    style={{ width: `${item.percentage}%` }}
                  />
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Trends Tab */}
        {activeTab === 'trends' && (
          <View>
            <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-slate-100 dark:border-slate-700">
              <Text className={`text-slate-900 dark:text-white ${sectionTitleSize} font-bold mb-4`}>
                {timeRange === 'year' ? t('trendMonthly') : t('trendDaily')}
              </Text>
              {dailyTrend.some(d => d.income > 0 || d.expense > 0) ? (
                <LineChart
                  data={{
                    labels: dailyTrend.filter((_, i) => i % Math.ceil(dailyTrend.length / 6) === 0).map(d => d.label),
                    datasets: [
                      {
                        data: dailyTrend.map(d => d.expense),
                        color: expenseDatasetColor,
                        strokeWidth: 2,
                      },
                      {
                        data: dailyTrend.map(d => d.income),
                        color: incomeDatasetColor,
                        strokeWidth: 2,
                      },
                    ],
                    legend: ['Expense', 'Income'],
                  }}
                  width={screenWidth - 80}
                  height={220}
                  yAxisSuffix="$"
                  chartConfig={chartConfig}
                  bezier
                  style={{ borderRadius: 16 }}
                />
              ) : (
                <View className="items-center justify-center py-10">
                  <FontAwesome name="line-chart" size={48} color="#cbd5e1" />
                  <Text className="text-slate-400 mt-4">{t('noTrendData')}</Text>
                </View>
              )}
            </View>

            {/* Spending Pattern */}
            <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-slate-100 dark:border-slate-700">
              <Text className={`text-slate-900 dark:text-white ${sectionTitleSize} font-bold mb-4`}>{t('spendingPattern')}</Text>
              <BarChart
                data={{
                  labels: dailyTrend.slice(-7).map(d => d.label),
                  datasets: [{ data: dailyTrend.slice(-7).map(d => d.expense) }],
                }}
                width={screenWidth - 80}
                height={220}
                yAxisLabel=""
                yAxisSuffix="$"
                chartConfig={{
                  ...chartConfig,
                  color: expenseDatasetColor,
                }}
                style={{ borderRadius: 16 }}
              />
            </View>
          </View>
        )}

        {/* Comparison Tab */}
        {activeTab === 'comparison' && (
          <View>
            <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-slate-100 dark:border-slate-700">
              <Text className={`text-slate-900 dark:text-white ${sectionTitleSize} font-bold mb-4`}>
                {t('incomeVsExpense')}
              </Text>
              <BarChart
                data={{
                  labels: ['Income', 'Expense', 'Balance'],
                  datasets: [{
                    data: [summary.income, summary.expense, Math.abs(summary.balance)],
                  }],
                }}
                width={screenWidth - 80}
                height={220}
                yAxisLabel=""
                yAxisSuffix="$"
                chartConfig={{
                  ...chartConfig,
                  color: (opacity = 1) => actualTheme === 'dark' ? `rgba(99, 102, 241, ${opacity})` : `rgba(99, 102, 241, ${opacity})`,
                  labelColor: (opacity = 1) => actualTheme === 'dark' ? `rgba(226, 232, 240, ${opacity})` : `rgba(100, 116, 139, ${opacity})`,
                }}
                style={{ borderRadius: 16 }}
              />
            </View>

            {/* Financial Health Score */}
            <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-slate-100 dark:border-slate-700">
              <Text className={`text-slate-900 dark:text-white ${sectionTitleSize} font-bold mb-4`}>
                {t('financialHealth')}
              </Text>
              <ProgressChart
                data={{
                  labels: ['Savings', 'Budget'],
                  data: [Math.min(Math.max(summary.savingsRate / 100, 0), 1), 0.75],
                }}
                width={screenWidth - 80}
                height={220}
                chartConfig={chartConfig}
                hideLegend={false}
              />
            </View>
          </View>
        )}

        <View className="h-8" />
      </ScrollView>

      {/* Export Selection Modal */}
      <Modal
        visible={isExportModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => { setExportModalVisible(false); setExportStep(1); }}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => { setExportModalVisible(false); setExportStep(1); }}
          className="flex-1 bg-black/50 justify-center items-center px-6"
        >
          <View className="bg-white dark:bg-slate-800 w-full rounded-3xl p-6 shadow-2xl">
            <Text className={`text-slate-900 dark:text-white ${isVerySmall ? 'text-lg' : 'text-xl'} font-bold mb-2`}>
              {exportStep === 1 ? '1. Select Report Content' : '2. Choose Format'}
            </Text>
            <Text className={`text-slate-500 mb-6 ${isVerySmall ? 'text-sm' : 'text-base'}`}>
              {exportStep === 1 ? 'Which information would you like to include?' : 'How would you like to receive the file?'}
            </Text>

            {exportStep === 1 ? (
              <View>
                <TouchableOpacity
                  onPress={() => { setSelectedReportType('transactions'); setExportStep(2); }}
                  className={`flex-row items-center ${isVerySmall ? 'p-3.5' : 'p-4'} bg-blue-50 dark:bg-blue-900/20 rounded-2xl mb-3 border border-blue-100 dark:border-blue-800`}
                >
                  <View className={`${isVerySmall ? 'w-9 h-9 mr-3' : 'w-10 h-10 mr-4'} bg-blue-500 rounded-xl justify-center items-center`}>
                    <FontAwesome name="list-alt" size={isVerySmall ? 16 : 18} color="#fff" />
                  </View>
                  <View className="flex-1">
                    <Text className={`text-blue-900 dark:text-blue-300 font-bold ${isVerySmall ? 'text-sm' : 'text-base'}`}>Transaction History</Text>
                    <Text className="text-slate-500 text-xs text-wrap">A complete ledger of all transactions.</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => { setSelectedReportType('summary'); setExportStep(2); }}
                  className={`flex-row items-center ${isVerySmall ? 'p-3.5' : 'p-4'} bg-emerald-50 dark:bg-emerald-900/20 rounded-2xl mb-3 border border-emerald-100 dark:border-emerald-800`}
                >
                  <View className={`${isVerySmall ? 'w-9 h-9 mr-3' : 'w-10 h-10 mr-4'} bg-emerald-500 rounded-xl justify-center items-center`}>
                    <FontAwesome name="pie-chart" size={isVerySmall ? 16 : 18} color="#fff" />
                  </View>
                  <View className="flex-1">
                    <Text className={`text-emerald-900 dark:text-emerald-300 font-bold ${isVerySmall ? 'text-sm' : 'text-base'}`}>Financial Summary</Text>
                    <Text className="text-slate-500 text-xs text-wrap">Category-wise breakdown and efficiency stats.</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => { setSelectedReportType('loans'); setExportStep(2); }}
                  className={`flex-row items-center ${isVerySmall ? 'p-3.5' : 'p-4'} bg-orange-50 dark:bg-orange-900/20 rounded-2xl mb-3 border border-orange-100 dark:border-orange-800`}
                >
                  <View className={`${isVerySmall ? 'w-9 h-9 mr-3' : 'w-10 h-10 mr-4'} bg-orange-500 rounded-xl justify-center items-center`}>
                    <FontAwesome name="users" size={isVerySmall ? 16 : 18} color="#fff" />
                  </View>
                  <View className="flex-1">
                    <Text className={`text-orange-900 dark:text-orange-300 font-bold ${isVerySmall ? 'text-sm' : 'text-base'}`}>Loans & Debts</Text>
                    <Text className="text-slate-500 text-xs text-wrap">Detailed status of outstanding balances.</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => { setSelectedReportType('all_data'); setExportStep(2); }}
                  className={`flex-row items-center ${isVerySmall ? 'p-3.5' : 'p-4'} bg-indigo-50 dark:bg-indigo-900/20 rounded-2xl mb-3 border border-indigo-100 dark:border-indigo-800`}
                >
                  <View className={`${isVerySmall ? 'w-9 h-9 mr-3' : 'w-10 h-10 mr-4'} bg-indigo-500 rounded-xl justify-center items-center`}>
                    <FontAwesome name="database" size={isVerySmall ? 16 : 18} color="#fff" />
                  </View>
                  <View className="flex-1">
                    <Text className={`text-indigo-900 dark:text-indigo-300 font-bold ${isVerySmall ? 'text-sm' : 'text-base'}`}>All Data Export</Text>
                    <Text className="text-slate-500 text-xs text-wrap">Accounts, transactions, budgets, and loans/debts in separate sheets.</Text>
                  </View>
                </TouchableOpacity>
              </View>
            ) : (
              <View>
                {selectedReportType !== 'all_data' ? (
                  <TouchableOpacity
                    onPress={() => handleExport('pdf')}
                    className={`flex-row items-center ${isVerySmall ? 'p-3.5' : 'p-4'} bg-red-50 dark:bg-red-900/20 rounded-2xl mb-3 border border-red-100 dark:border-red-800`}
                  >
                    <View className={`${isVerySmall ? 'w-10 h-10 mr-3' : 'w-12 h-12 mr-4'} bg-red-500 rounded-xl justify-center items-center`}>
                      <FontAwesome name="file-pdf-o" size={isVerySmall ? 18 : 20} color="#fff" />
                    </View>
                    <View className="flex-1">
                      <Text className={`text-slate-900 dark:text-white font-bold ${isVerySmall ? 'text-sm' : 'text-base'}`}>{t('pdfDocument')}</Text>
                      <Text className="text-slate-500 text-xs text-wrap">{t('pdfDesc')}</Text>
                    </View>
                  </TouchableOpacity>
                ) : null}

                <TouchableOpacity
                  onPress={() => handleExport('excel')}
                  className={`flex-row items-center ${isVerySmall ? 'p-3.5' : 'p-4'} bg-green-50 dark:bg-green-900/20 rounded-2xl mb-3 border border-green-100 dark:border-green-800`}
                >
                  <View className={`${isVerySmall ? 'w-10 h-10 mr-3' : 'w-12 h-12 mr-4'} bg-green-500 rounded-xl justify-center items-center`}>
                    <FontAwesome name="file-excel-o" size={isVerySmall ? 18 : 20} color="#fff" />
                  </View>
                  <View className="flex-1">
                    <Text className={`text-slate-900 dark:text-white font-bold ${isVerySmall ? 'text-sm' : 'text-base'}`}>{t('excelSheet')}</Text>
                    <Text className="text-slate-500 text-xs text-wrap">
                      {selectedReportType === 'all_data'
                        ? 'Includes accounts, transactions, budgets, and loans/debts sheets.'
                        : t('excelDesc')}
                    </Text>
                  </View>
                </TouchableOpacity>
              </View>
            )}

            <TouchableOpacity
              onPress={() => {
                if (exportStep === 2) setExportStep(1);
                else setExportModalVisible(false);
              }}
              className="mt-2 py-4 justify-center items-center"
            >
              <Text className="text-slate-500 font-bold">{exportStep === 2 ? '← Back' : t('cancel')}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View >
  );
}
