import { useLedgerClock } from '@/hooks/useLedgerClock';
import { operatingTransactions, reportPeriod, sumMoney, trendBuckets } from '@/utils/finance';
import BudgetService from '@/services/BudgetService';
import ScreenInfoCard from '@/components/ScreenInfoCard';
import { sessionLocalStorage } from '@/services/SessionStorage';
import AIInsights from '@/components/AIInsights';
import { useTransactions } from '@/context/TransactionContext';
import { useAppSettings } from '@/contexts/AppSettingsContext';
import { useI18n } from '@/contexts/I18nContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import ExportService from '@/services/ExportService';
import ForecastService, { ForecastEvent } from '@/services/ForecastService';
import SafeToSpendService from '@/services/SafeToSpendService';
import ReconciliationService from '@/services/ReconciliationService';
import { DraftTransactionService, type DraftTransaction } from '@/services/DraftTransactionService';
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
import { RecurringTransaction } from '@/types/database';
import AsyncStorage from '@/services/SessionStorage';
import { useEffect, useMemo, useState } from 'react';
import { Dimensions, InteractionManager, Platform, ScrollView, Text, TouchableOpacity, View, Modal } from 'react-native';
import { Alert } from '@/utils/alert';
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
  const ledgerNow = useLedgerClock();
  const dispatch = useDispatch<AppDispatch>();
  const { user } = useAuth();
  const { categories } = useTransactions();
  const transactions = useSelector((s: RootState) => s.transactions.items);
  const budgets = useSelector((s: RootState) => s.budgets.items);
  const loans = useSelector((s: RootState) => s.loans.items);
  const accounts = useSelector((s: RootState) => s.accounts.items);
  const [recurring, setRecurring] = useState<RecurringTransaction[]>([]);
  const [smsDrafts, setSmsDrafts] = useState<DraftTransaction[]>([]);
  const [forecastDays, setForecastDays] = useState<7 | 30 | 90>(30);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isExportModalVisible, setExportModalVisible] = useState(false);
  const [selectedReportType, setSelectedReportType] = useState<'transactions' | 'summary' | 'loans' | 'all_data'>('transactions');
  const [exportStep, setExportStep] = useState<1 | 2>(1);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      dispatch(fetchBudgets());
      dispatch(fetchLoans());
      dispatch(fetchTransactions());
      dispatch(fetchAccounts());
      void loadRecurring();
    });

    const unsubscribe = LocalChangeEmitter.subscribe(async () => {
      await loadRecurring();
    });

    return () => {
      task.cancel();
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [dispatch]);

  const loadRecurring = async () => {
    try {
      const stored = Platform.OS === 'web'
        ? sessionLocalStorage.getItem('recurring_transactions')
        : await AsyncStorage.getItem('@hisabtrack_recurring_transactions');
      if (stored) setRecurring(JSON.parse(stored));
      setSmsDrafts(await DraftTransactionService.getAll());
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

  const period = useMemo(() => reportPeriod(timeRange, ledgerNow,
    transactions.reduce((oldest, tx) => Math.min(oldest, tx.date), ledgerNow)), [timeRange, ledgerNow, transactions]);
  const filteredTransactions = useMemo(() => operatingTransactions(transactions).filter(tx =>
    tx.date >= period.start && tx.date <= period.end), [transactions, period]);
  const previousPeriodTransactions = useMemo(() => operatingTransactions(transactions).filter(tx =>
    tx.date >= period.previousStart && tx.date < period.start), [transactions, period]);

  // Calculate summary statistics
  const summary = useMemo(() => {
    const income = sumMoney(filteredTransactions
      .filter(t => (t.type || '').toString().toUpperCase() === 'INCOME')
      .map(t => t.amount || 0));

    const expense = sumMoney(filteredTransactions
      .filter(t => (t.type || '').toString().toUpperCase() === 'EXPENSE')
      .map(t => t.amount || 0));

    const balance = income - expense;
    const savingsRate = income > 0 ? ((income - expense) / income) * 100 : 0;
    const days = period.days;
    const avgDailyExpense = expense / days;

    return {
      income,
      expense,
      balance,
      savingsRate,
      avgDailyExpense,
      transactionCount: filteredTransactions.length,
    };
  }, [filteredTransactions, timeRange, period]);

  // Monthly Aggregation for Analysis
  const monthlyData = useMemo(() => {
    const data: Record<string, { income: number; expense: number; date: Date }> = {};
    // Use ALL transactions for historical analysis
    operatingTransactions(transactions).filter(t => t.date <= ledgerNow).forEach(t => {
      const d = new Date(typeof t.date === 'number' ? t.date : new Date(t.date).getTime());
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (!data[key]) data[key] = { income: 0, expense: 0, date: new Date(d.getFullYear(), d.getMonth(), 1) };

      if ((t.type || '').toString().toUpperCase() === 'INCOME') data[key].income += (t.amount || 0);
      else if ((t.type || '').toString().toUpperCase() === 'EXPENSE') data[key].expense += (t.amount || 0);
    });

    const dates = Object.values(data).map(month => month.date.getTime());
    if (dates.length) {
      const cursor = new Date(Math.min(...dates));
      const end = new Date(ledgerNow);
      while (cursor <= end) {
        const key = `${cursor.getFullYear()}-${cursor.getMonth()}`;
        if (!data[key]) data[key] = { income: 0, expense: 0, date: new Date(cursor) };
        cursor.setMonth(cursor.getMonth() + 1);
      }
    }
    return Object.values(data).sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [transactions, ledgerNow]);

  // Analysis Stats
  const analysisStats = useMemo(() => {
    // The month in progress is only partially recorded, so including it made
    // "lowest spending month" almost always report the current month for the
    // first few weeks, and dragged the monthly average down.
    const current = new Date(ledgerNow);
    const currentMonthStart = new Date(current.getFullYear(), current.getMonth(), 1).getTime();
    const completeMonths = monthlyData.filter(m => m.date.getTime() < currentMonthStart);
    // With only the current month on record there is nothing complete to
    // compare, so fall back to it rather than showing zeroes.
    const months = completeMonths.length > 0 ? completeMonths : monthlyData;

    let maxIncome = { amount: 0, month: 'N/A' };
    let minIncome = { amount: Infinity, month: 'N/A' };
    let maxExpense = { amount: 0, month: 'N/A' };
    let minExpense = { amount: Infinity, month: 'N/A' };

    months.forEach(m => {
      const monthStr = m.date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

      if (m.income > maxIncome.amount) maxIncome = { amount: m.income, month: monthStr };
      if (m.income < minIncome.amount) minIncome = { amount: m.income, month: monthStr };

      if (m.expense > maxExpense.amount) maxExpense = { amount: m.expense, month: monthStr };
      if (m.expense < minExpense.amount) minExpense = { amount: m.expense, month: monthStr };
    });

    if (minIncome.amount === Infinity) minIncome = { amount: 0, month: 'N/A' };
    if (minExpense.amount === Infinity) minExpense = { amount: 0, month: 'N/A' };

    const avgMonthlyExpense = months.length > 0
      ? sumMoney(months.map(m => m.expense)) / months.length
      : 0;

    return {
      maxIncome,
      minIncome,
      maxExpense,
      minExpense,
      avgMonthlyExpense,
      // Lets the UI say which basis the figures use.
      excludesCurrentMonth: completeMonths.length > 0,
    };
  }, [monthlyData, ledgerNow]);

  // Historical reference (avg of last 3 months)
  const historicalForecast = useMemo(() => {
    const current = new Date(ledgerNow);
    const last3 = monthlyData.filter(month => month.date < new Date(current.getFullYear(), current.getMonth(), 1)).slice(-3);
    if (last3.length === 0) return { income: 0, expense: 0 };
    const avgInc = last3.reduce((s, m) => s + m.income, 0) / last3.length;
    const avgExp = last3.reduce((s, m) => s + m.expense, 0) / last3.length;
    return { income: avgInc, expense: avgExp };
  }, [monthlyData, ledgerNow]);

  /**
   * Budget adherence across the budgets active right now: the share of the
   * combined limit still unspent. The "Financial Health" ring previously
   * rendered a hardcoded 0.75 here, so every user was shown 75% budget health
   * regardless of their data — including users with no budgets at all.
   * `null` means there is nothing to measure, and the ring is omitted.
   */
  const budgetHealth = useMemo(() => {
    const active = budgets.filter(b => b.start_date <= ledgerNow && b.end_date >= ledgerNow);
    if (active.length === 0) return null;
    const metrics = BudgetService.calculateBudgetCollectionMetrics(active, budgets, transactions);
    const totalLimit = sumMoney(metrics.map(m => m.effectiveLimit));
    if (totalLimit <= 0) return null;
    const totalSpent = sumMoney(metrics.map(m => m.spent));
    return Math.min(Math.max((totalLimit - totalSpent) / totalLimit, 0), 1);
  }, [budgets, transactions, ledgerNow]);

  // Nothing to report on: no accounts and no postings at all. An empty
  // *period* still shows the charts, because a quiet month is real data.
  const hasNoLedgerData = accounts.length === 0 && transactions.length === 0;

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
        transactions,
      }),
    [accounts, recurring, loans, forecastDays, transactions]
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
  const unresolvedBalanceGaps = useMemo(
    () => ReconciliationService.unresolvedCount(accounts, smsDrafts, transactions),
    [accounts, smsDrafts, transactions]
  );
  const safeToSpend = useMemo(
    () => SafeToSpendService.calculate(accounts, forecastResult, unresolvedBalanceGaps),
    [accounts, forecastResult, unresolvedBalanceGaps]
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

  // Trend buckets come from the same `period` as the headline summary, so the
  // chart always describes the window the user selected. Previously "Month"
  // charted a trailing 30 days against month-to-date totals, and "All" charted
  // only the last 12 days.
  const dailyTrend = useMemo(() => {
    const buckets = trendBuckets(period.start, period.end);
    const totals = buckets.map(bucket => ({
      date: new Date(bucket.start),
      label: bucket.granularity === 'month'
        ? new Date(bucket.start).toLocaleDateString('en-US', { month: 'short' })
        : new Date(bucket.start).getDate().toString(),
      income: [] as number[],
      expense: [] as number[],
    }));

    for (const transaction of filteredTransactions) {
      const at = typeof transaction.date === 'number' ? transaction.date : new Date(transaction.date).getTime();
      const index = buckets.findIndex(bucket => at >= bucket.start && at <= bucket.end);
      if (index === -1) continue;
      const type = (transaction.type || '').toString().toUpperCase();
      if (type === 'INCOME') totals[index].income.push(transaction.amount || 0);
      else if (type === 'EXPENSE') totals[index].expense.push(transaction.amount || 0);
    }

    return totals.map(bucket => ({
      date: bucket.date,
      label: bucket.label,
      income: sumMoney(bucket.income),
      expense: sumMoney(bucket.expense),
    }));
  }, [filteredTransactions, period]);

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

      {/* Header */}
      <LinearGradient
        colors={['#4f46e5', '#4338ca']}
        className="px-6 pt-3 pb-8 rounded-b-[32px]"
        style={{ elevation: 4 }}
      >
        <View className="flex-row justify-between items-center mb-6">
          <Text className={`text-white font-bold ${headerTitleSize}`}>{t('reports.title')}</Text>
          <View className="flex-row gap-2">
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="AI insights"
              onPress={() => router.push('/aiassistant')}
              className={iconButtonClass}
            >
              <FontAwesome name="magic" size={isVerySmall ? 16 : 18} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Refresh data" accessibilityState={{ busy: isSyncing, disabled: isSyncing }}
              onPress={handleManualSync}
              disabled={isSyncing}
              className={iconButtonClass}
            >
              <FontAwesome name={isSyncing ? "spinner" : "refresh"} size={isVerySmall ? 16 : 18} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Export report" accessibilityState={{ busy: isExporting }}
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
              className={`${timeRangeButtonClass} ${timeRange === range.value ? 'bg-white' : 'bg-white/20' }`}
            >
              <Text
                className={`text-center font-semibold ${timeRangeTextClass} ${timeRange === range.value ? 'text-indigo-600' : 'text-white' }`}
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
              className={`${tabButtonClass} ${activeTab === tab.value ? 'bg-indigo-500' : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700' }`}
            >
              <FontAwesome
                name={tab.icon as any}
                size={isVerySmall ? 11 : 12}
                color={activeTab === tab.value ? '#fff' : '#64748b'}
              />
              <Text
                className={`${tabLabelClass} ${activeTab === tab.value ? 'text-white' : 'text-slate-600 dark:text-slate-400' }`}
              >
                {t(tab.label.toLowerCase())}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View >

      <ScrollView className="flex-1 px-6 mt-4" showsVerticalScrollIndicator={false}>
        {/* First run: with no ledger history every chart renders as zeroes,
            which reads as "your finances are empty" rather than "there is
            nothing to report yet". */}
        {hasNoLedgerData ? (
          <ScreenInfoCard
            icon="bar-chart"
            title="Your reports will appear here"
            description="Once you have recorded a few transactions, this screen shows where your money goes, how your months compare, and what is coming up."
            suggestions={[
              'Add an account, then record an income or expense to get started.',
              'On Android, connect a bank SMS sender so transactions are suggested for you.',
              'Set a budget to see how your spending tracks against it.',
            ]}
          />
        ) : null}

        {/* Overview Tab */}
        {!hasNoLedgerData && activeTab === 'overview' && (
          <View>
            {/* Summary Cards */}
            <View className="flex-row gap-3 mb-6">
              <View className="flex-1 bg-green-50 dark:bg-green-900/20 p-4 rounded-2xl border-2 border-green-200 dark:border-green-800">
                <Text className="text-green-600 text-xs font-bold mb-1">{t('income').toUpperCase()}</Text>
                <Text adjustsFontSizeToFit numberOfLines={1} minimumFontScale={0.6} className="text-green-700 dark:text-green-400 text-2xl font-bold">
                  {formatCurrency(summary.income)}
                </Text>
              </View>
              <View className="flex-1 bg-red-50 dark:bg-red-900/20 p-4 rounded-2xl border-2 border-red-200 dark:border-red-800">
                <Text className="text-red-600 text-xs font-bold mb-1">{t('expense').toUpperCase()}</Text>
                <Text adjustsFontSizeToFit numberOfLines={1} minimumFontScale={0.6} className="text-red-700 dark:text-red-400 text-2xl font-bold">
                  {formatCurrency(summary.expense)}
                </Text>
              </View>
            </View>

            <View className="flex-row gap-3 mb-6">
              <View className="flex-1 bg-blue-50 dark:bg-blue-900/20 p-4 rounded-2xl border-2 border-blue-200 dark:border-blue-800">
                <Text className="text-blue-600 text-xs font-bold mb-1">{t('netBalance')}</Text>
                <Text className={`text-2xl font-bold ${summary.balance >= 0 ? 'text-green-600' : 'text-red-600' }`}>
                  {formatCurrency(Math.abs(summary.balance))}
                </Text>
              </View>
              <View className="flex-1 bg-purple-50 dark:bg-purple-900/20 p-4 rounded-2xl border-2 border-purple-200 dark:border-purple-800">
                <Text className="text-purple-600 text-xs font-bold mb-1">{t('savingsRateLabel')}</Text>
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
        {!hasNoLedgerData && activeTab === 'forecast' && (
          <View>
            <View className="flex-row gap-2 mb-4">
              {FORECAST_HORIZONS.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  onPress={() => setForecastDays(option.value)}
                  className={`flex-1 ${isVerySmall ? 'py-2.5' : 'py-3'} rounded-2xl border ${ forecastDays === option.value ? 'bg-indigo-500 border-indigo-500' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700' }`}
                >
                  <Text
                    className={`text-center font-bold ${isVerySmall ? 'text-xs' : 'text-sm'} ${ forecastDays === option.value ? 'text-white' : 'text-slate-700 dark:text-slate-300' }`}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <LinearGradient colors={['#1d4ed8', '#4338ca']} className="rounded-3xl p-6 mb-6 shadow-lg">
              <View className="flex-row justify-between items-start mb-5">
                <View className="flex-1 pr-4">
                  <Text className="text-white/90 font-bold mb-1">Cashflow Forecast</Text>
                  <Text className="text-white/90 text-sm">
                    Next {forecastDays} days from current balances, recurring activity, and active debt due dates.
                  </Text>
                </View>
                <View className="items-end">
                  <Text className="text-white/90 text-xs">Projected Change</Text>
                  <Text
                    className={`text-xl font-bold ${ forecastResult.projectedBalance - forecastResult.startingBalance >= 0 ? 'text-emerald-200' : 'text-rose-200' }`}
                  >
                    {formatCurrency(forecastResult.projectedBalance - forecastResult.startingBalance)}
                  </Text>
                </View>
              </View>

              <View className="flex-row gap-3">
                <View className="flex-1 bg-white/10 rounded-2xl p-4">
                  <Text className="text-white/90 text-xs mb-1">Current Balance</Text>
                  <Text adjustsFontSizeToFit numberOfLines={1} minimumFontScale={0.6} className="text-white text-2xl font-bold">{formatCurrency(forecastResult.startingBalance)}</Text>
                </View>
                <View className="flex-1 bg-white/10 rounded-2xl p-4">
                  <Text className="text-white/90 text-xs mb-1">Projected Balance</Text>
                  <Text adjustsFontSizeToFit numberOfLines={1} minimumFontScale={0.6} className="text-white text-2xl font-bold">{formatCurrency(forecastResult.projectedBalance)}</Text>
                </View>
              </View>

              <View
                className="mt-4 pt-4 flex-row justify-between items-end"
                style={{ borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.18)' }}
              >
                <View>
                  <Text className="text-white/90 text-xs mb-1">Lowest Balance</Text>
                  <Text adjustsFontSizeToFit numberOfLines={1} minimumFontScale={0.6} className="text-white text-xl font-bold">{formatCurrency(forecastResult.lowestBalance)}</Text>
                </View>
                <View className="items-end">
                  <Text className="text-white/90 text-xs mb-1">Lowest Date</Text>
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
                <Text adjustsFontSizeToFit numberOfLines={1} minimumFontScale={0.6} className="text-emerald-700 dark:text-emerald-300 text-xl font-bold">
                  {formatCurrency(forecastResult.upcomingIncome)}
                </Text>
              </View>
              <View className="flex-1 bg-orange-50 dark:bg-orange-900/20 p-4 rounded-2xl border border-orange-200 dark:border-orange-800">
                <Text className="text-orange-600 text-xs font-bold mb-1">Scheduled Outflows</Text>
                <Text adjustsFontSizeToFit numberOfLines={1} minimumFontScale={0.6} className="text-orange-700 dark:text-orange-300 text-xl font-bold">
                  {formatCurrency(forecastResult.upcomingExpense + forecastResult.upcomingLoanPayments)}
                </Text>
              </View>
            </View>

            <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-slate-100 dark:border-slate-700">
              <View className="flex-row items-start justify-between mb-4">
                <View className="flex-1 pr-4">
                  <Text className={`${sectionTitleSize} text-slate-900 dark:text-white font-bold`}>{t('safeToSpend')}</Text>
                  <Text className="text-slate-500 dark:text-slate-400 text-xs mt-1">
                    Available through {safeToSpend.horizonEnd ? new Date(safeToSpend.horizonEnd).toLocaleDateString() : 'this forecast'} after locked money, account reserves, and scheduled activity.
                  </Text>
                </View>
                <Text adjustsFontSizeToFit numberOfLines={1} minimumFontScale={0.6} className="text-emerald-600 dark:text-emerald-400 text-xl font-bold">
                  {formatCurrency(safeToSpend.total)}
                </Text>
              </View>
              {safeToSpend.accounts.map(row => (
                <View key={row.accountId} className="py-3 border-t border-slate-100 dark:border-slate-700">
                  <View className="flex-row justify-between items-center">
                    <Text className="text-slate-900 dark:text-white font-semibold flex-1">{row.accountName}</Text>
                    <Text className="text-slate-900 dark:text-white font-bold">{formatCurrency(row.safeToSpend)}</Text>
                  </View>
                  <Text className="text-slate-500 dark:text-slate-400 text-[11px] mt-1">
                    Lowest planned {formatCurrency(row.lowestProjectedBalance)} · reserve {formatCurrency(row.reserveAmount)} · locked {formatCurrency(row.lockedAmount)}
                  </Text>
                </View>
              ))}
              {safeToSpend.unassignedCommitments > 0 && (
                <View className="flex-row justify-between items-center py-3 border-t border-slate-100 dark:border-slate-700">
                  <Text className="text-amber-700 dark:text-amber-300 text-xs font-semibold flex-1">{t('unassignedLoanObligations')}</Text>
                  <Text className="text-amber-700 dark:text-amber-300 text-xs font-bold">−{formatCurrency(safeToSpend.unassignedCommitments)}</Text>
                </View>
              )}
              <View className="py-3 border-t border-slate-100 dark:border-slate-700">
                <View className="flex-row justify-between"><Text className="text-slate-500 dark:text-slate-400 text-xs">{t('confirmedScheduledIncome')}</Text><Text className="text-emerald-600 text-xs font-bold">+{formatCurrency(safeToSpend.confirmedUpcomingIncome)}</Text></View>
                <View className="flex-row justify-between mt-1"><Text className="text-slate-500 dark:text-slate-400 text-xs">{t('scheduledOutflows')}</Text><Text className="text-red-600 text-xs font-bold">−{formatCurrency(safeToSpend.scheduledOutflows)}</Text></View>
                {safeToSpend.uncertainIncome > 0 && <View className="flex-row justify-between mt-1"><Text className="text-slate-500 dark:text-slate-400 text-xs">Inferred income (not counted)</Text><Text className="text-amber-600 text-xs font-bold">{formatCurrency(safeToSpend.uncertainIncome)}</Text></View>}
                <Text className={`text-[10px] font-bold mt-2 ${safeToSpend.confidence === 'HIGH' ? 'text-emerald-600' : safeToSpend.confidence === 'MEDIUM' ? 'text-amber-600' : 'text-red-600'}`}>Confidence: {safeToSpend.confidence.toLowerCase()}</Text>
                {safeToSpend.limitations.map(limitation => <Text key={limitation} className="text-amber-600 dark:text-amber-400 text-[10px] mt-1">• {limitation}</Text>)}
              </View>
              <Text className="text-amber-600 dark:text-amber-400 text-[10px] mt-2">
                Based on confirmed balances and saved schedules. Unrecorded SMS and unscheduled spending are not included.
              </Text>
            </View>

            {forecastResult.lowBalanceWarnings.map(warning => (
              <View key={`${warning.accountId}-${warning.crossingDate}`} className="bg-red-50 dark:bg-red-950/20 rounded-2xl p-4 mb-4 border border-red-200 dark:border-red-900/40">
                <Text className="text-red-700 dark:text-red-300 font-bold">Reserve risk · {warning.accountName}</Text>
                <Text className="text-red-600 dark:text-red-400 text-xs mt-1">
                  May fall to {formatCurrency(warning.projectedBalance)} on {new Date(warning.crossingDate).toLocaleDateString()}, below the {formatCurrency(warning.reserveAmount)} reserve.
                </Text>
                {warning.causingEvents.length > 0 && <Text className="text-red-600/80 dark:text-red-300/80 text-[11px] mt-2">Caused by: {warning.causingEvents.map(event => event.title).join(', ')}</Text>}
              </View>
            ))}

            {forecastResult.inferredIncome.length > 0 && (
              <View className="bg-amber-50 dark:bg-amber-950/20 rounded-2xl p-4 mb-6 border border-amber-200 dark:border-amber-900/40">
                <Text className="text-amber-800 dark:text-amber-200 font-bold">{t('possibleUpcomingIncome')}</Text>
                <Text className="text-amber-700/80 dark:text-amber-300/80 text-xs mt-1 mb-2">Learned from repeated income history. These amounts are uncertain and are excluded from projected balances and safe-to-spend.</Text>
                {forecastResult.inferredIncome.map(item => <View key={item.id} className="py-2 border-t border-amber-200 dark:border-amber-900/40"><View className="flex-row justify-between"><Text className="text-amber-900 dark:text-amber-100 font-semibold flex-1">{item.label}</Text><Text className="text-amber-800 dark:text-amber-200 font-bold">{formatCurrency(item.amount)}</Text></View><Text className="text-amber-700 dark:text-amber-300 text-[10px] mt-1">Expected around {new Date(item.expectedDate).toLocaleDateString()} ±{item.toleranceDays} day{item.toleranceDays === 1 ? '' : 's'} · {item.confidence.toLowerCase()} confidence from {item.sampleCount} payments</Text></View>)}
              </View>
            )}

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
                        Forecast uses unlocked cash, recurring rules, and full outstanding debts due within the horizon, including overdue debts today. It excludes uncertain loan collections. Do not enter the same loan payment as a recurring expense.
                      </Text>
                    </View>
                  </View>
                  <Text adjustsFontSizeToFit numberOfLines={1} minimumFontScale={0.6} className="text-amber-700 dark:text-amber-300 font-bold text-lg">
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
                  <Text className="text-slate-500 mt-4 dark:text-slate-400">Not enough scheduled activity to draw a forecast yet.</Text>
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
                        <Text className="text-slate-500 text-xs dark:text-slate-400">
                          Bal: {formatCurrency(event.balanceAfter ?? forecastResult.startingBalance)}
                        </Text>
                      </View>
                    </View>
                  );
                })
              ) : (
                <Text className="text-slate-500 text-center py-8 dark:text-slate-400">
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
                    <Text adjustsFontSizeToFit numberOfLines={1} minimumFontScale={0.6} className="text-red-600 font-bold text-lg">{formatCurrency(event.amount)}</Text>
                  </View>
                ))
              ) : (
                <Text className="text-slate-500 text-center py-8 dark:text-slate-400">
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
                      <Text adjustsFontSizeToFit numberOfLines={1} minimumFontScale={0.6} className="text-slate-900 dark:text-white font-bold text-lg">
                        {formatCurrency(projection.projectedBalance)}
                      </Text>
                      <Text
                        className={`text-xs font-semibold ${ projection.delta >= 0 ? 'text-emerald-600' : 'text-red-600' }`}
                      >
                        {projection.delta >= 0 ? '+' : ''}
                        {formatCurrency(projection.delta)}
                      </Text>
                    </View>
                  </View>
                ))
              ) : (
                <Text className="text-slate-500 text-center py-8 dark:text-slate-400">
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
                  <Text adjustsFontSizeToFit numberOfLines={1} minimumFontScale={0.6} className="text-green-700 dark:text-green-300 text-lg font-bold">
                    {formatCurrency(historicalForecast.income)}
                  </Text>
                </View>
                <View className="flex-1 bg-red-50 dark:bg-red-900/10 p-4 rounded-2xl">
                  <Text className="text-red-600 text-xs font-bold mb-1">3-Month Avg Expense</Text>
                  <Text adjustsFontSizeToFit numberOfLines={1} minimumFontScale={0.6} className="text-red-700 dark:text-red-300 text-lg font-bold">
                    {formatCurrency(historicalForecast.expense)}
                  </Text>
                </View>
              </View>

              <View className="bg-slate-50 dark:bg-slate-900/40 rounded-2xl p-4">
                <View className="flex-row justify-between">
                  <View>
                    <Text className="text-slate-500 dark:text-slate-400 text-xs">Avg Monthly Expense</Text>
                    <Text className="text-slate-900 dark:text-white font-bold">{formatCurrency(analysisStats.avgMonthlyExpense)}</Text>
                  </View>
                  <View className="items-end">
                    <Text className="text-slate-500 dark:text-slate-400 text-xs">Best Income Month</Text>
                    <Text className="text-slate-900 dark:text-white font-bold">{analysisStats.maxIncome.month}</Text>
                  </View>
                </View>
                {/* Say which months the figures cover, so a partial month is not mistaken for a real low. */}
                <Text className="text-slate-500 dark:text-slate-400 text-[10px] mt-2">
                  {analysisStats.excludesCurrentMonth
                    ? 'Based on completed months only; the month in progress is excluded.'
                    : 'Based on the current month so far.'}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Income Tab */}
        {!hasNoLedgerData && activeTab === 'income' && (
          <View>
            <LinearGradient colors={['#22c55e', '#16a34a']} className="rounded-3xl p-6 mb-6">
              <Text className="text-white/90 text-sm mb-2">{t('totalIncome')}</Text>
              <Text adjustsFontSizeToFit numberOfLines={1} minimumFontScale={0.6} className="text-white text-4xl font-bold">{formatCurrency(summary.income)}</Text>
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
                      <Text className="text-slate-500 dark:text-slate-400 text-xs">{item.percentage.toFixed(1)}% of total</Text>
                    </View>
                  </View>
                  <Text adjustsFontSizeToFit numberOfLines={1} minimumFontScale={0.6} className="text-green-600 font-bold text-lg">{formatCurrency(item.amount)}</Text>
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
        {!hasNoLedgerData && activeTab === 'expense' && (
          <View>
            <LinearGradient colors={['#ef4444', '#dc2626']} className="rounded-3xl p-6 mb-6">
              <Text className="text-white/90 text-sm mb-2">{t('totalExpenses')}</Text>
              <Text adjustsFontSizeToFit numberOfLines={1} minimumFontScale={0.6} className="text-white text-4xl font-bold">{formatCurrency(summary.expense)}</Text>
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
                      <Text className="text-slate-500 dark:text-slate-400 text-xs">{item.percentage.toFixed(1)}% of total</Text>
                    </View>
                  </View>
                  <Text adjustsFontSizeToFit numberOfLines={1} minimumFontScale={0.6} className="text-red-600 font-bold text-lg">{formatCurrency(item.amount)}</Text>
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
        {!hasNoLedgerData && activeTab === 'trends' && (
          <View>
            <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-slate-100 dark:border-slate-700">
              <Text className={`text-slate-900 dark:text-white ${sectionTitleSize} font-bold mb-4`}>
                {timeRange === 'year' ? t('trendMonthly') : t('trendDaily')}
              </Text>
              {dailyTrend.some(d => d.income > 0 || d.expense > 0) ? (
                <LineChart
                  data={{
                    labels: dailyTrend.filter((_, i) => i % Math.max(1, Math.ceil(dailyTrend.length / 6)) === 0).map(d => d.label),
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
                  <Text className="text-slate-500 mt-4 dark:text-slate-400">{t('noTrendData')}</Text>
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
        {!hasNoLedgerData && activeTab === 'comparison' && (
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
                  labels: budgetHealth === null ? ['Savings'] : ['Savings', 'Budget'],
                  data: budgetHealth === null
                    ? [Math.min(Math.max(summary.savingsRate / 100, 0), 1)]
                    : [Math.min(Math.max(summary.savingsRate / 100, 0), 1), budgetHealth],
                }}
                width={screenWidth - 80}
                height={220}
                chartConfig={chartConfig}
                hideLegend={false}
              />
              <Text className="text-slate-500 dark:text-slate-400 text-[10px] mt-2">
                {budgetHealth === null
                  ? 'Savings rate for the selected period. Set a budget to track budget health here.'
                  : 'Savings rate for the selected period, and the share of your active budgets still unspent.'}
              </Text>
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
            <Text className={`text-slate-500 dark:text-slate-400 mb-6 ${isVerySmall ? 'text-sm' : 'text-base'}`}>
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
                    <Text className="text-slate-500 dark:text-slate-400 text-xs text-wrap">A complete ledger of all transactions.</Text>
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
                    <Text className="text-slate-500 dark:text-slate-400 text-xs text-wrap">Category-wise breakdown and efficiency stats.</Text>
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
                    <Text className="text-slate-500 dark:text-slate-400 text-xs text-wrap">Detailed status of outstanding balances.</Text>
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
                    <Text className="text-slate-500 dark:text-slate-400 text-xs text-wrap">Accounts, transactions, budgets, and loans/debts in separate sheets.</Text>
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
                      <Text className="text-slate-500 dark:text-slate-400 text-xs text-wrap">{t('pdfDesc')}</Text>
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
                    <Text className="text-slate-500 dark:text-slate-400 text-xs text-wrap">
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
              <Text className="text-slate-500 dark:text-slate-400 font-bold">{exportStep === 2 ? '← Back' : t('cancel')}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View >
  );
}
