import AIInsights from '@/components/AIInsights';
import { CATEGORIES } from '@/constants/MockData';
import { useAppSettings } from '@/contexts/AppSettingsContext';
import { useI18n } from '@/contexts/I18nContext';
import { useTheme } from '@/contexts/ThemeContext';
import { RootState } from '@/store';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import { Dimensions, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { BarChart, LineChart, PieChart, ProgressChart } from 'react-native-chart-kit';

import { useSelector } from 'react-redux';

const screenWidth = Dimensions.get('window').width;

type TimeRange = 'week' | 'month' | 'year' | 'all';
type ReportTab = 'overview' | 'income' | 'expense' | 'trends' | 'comparison' | 'analysis';

export default function ReportsScreen() {
  const transactions = useSelector((s: RootState) => s.transactions.items);
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
  const headerTitleSize = fontSize === 'Small' ? 'text-xl' : fontSize === 'Large' ? 'text-3xl' : 'text-2xl';
  const sectionTitleSize = fontSize === 'Small' ? 'text-base' : fontSize === 'Large' ? 'text-xl' : 'text-lg';
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
    const days = timeRange === 'week' ? 7 : timeRange === 'month' ? 30 : timeRange === 'year' ? 365 : 1; // 'all' might need simpler div
    const avgDailyExpense = expense / (days || 1);

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

  // Forecast (Avg of last 3 months)
  const forecast = useMemo(() => {
    const last3 = monthlyData.slice(-3);
    if (last3.length === 0) return { income: 0, expense: 0 };
    const avgInc = last3.reduce((s, m) => s + m.income, 0) / last3.length;
    const avgExp = last3.reduce((s, m) => s + m.expense, 0) / last3.length;
    return { income: avgInc, expense: avgExp };
  }, [monthlyData]);

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
    { value: 'analysis', label: 'Analysis', icon: 'bar-chart' }, // New tab
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
        colors={actualTheme === 'dark' ? ['#334155', '#1e293b'] : ['#4f46e5', '#4338ca']}
        className="px-6 pt-6 pb-2 rounded-b-[32px]"
      >
        <Text className={`text-white ${headerTitleSize} font-bold mb-6`}>{t('reports')}</Text>

        {/* Time Range Selector */}
        <View className="flex-row gap-2">
          {timeRanges.map((range) => (
            <TouchableOpacity
              key={range.value}
              onPress={() => setTimeRange(range.value)}
              className={`flex-1 py-1.5 rounded-lg ${timeRange === range.value
                  ? 'bg-white'
                  : 'bg-white/20'
                }`}
            >
              <Text
                className={`text-center font-semibold text-xs ${timeRange === range.value
                    ? 'text-indigo-600'
                    : 'text-white'
                  }`}
              >
                {range.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </LinearGradient>

      {/* Tab Navigation */}
      <View className="px-6 pb-0" style={{ marginTop: 0 }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          {tabs.map((tab) => (
            <TouchableOpacity
              key={tab.value}
              onPress={() => setActiveTab(tab.value)}
              className={`px-3 py-1.5 rounded-lg flex-row items-center ${activeTab === tab.value
                  ? 'bg-indigo-500'
                  : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700'
                }`}
            >
              <FontAwesome
                name={tab.icon as any}
                size={12}
                color={activeTab === tab.value ? '#fff' : '#64748b'}
              />
              <Text
                className={`ml-1.5 font-semibold text-xs ${activeTab === tab.value
                    ? 'text-white'
                    : 'text-slate-600 dark:text-slate-400'
                  }`}
              >
                {t(tab.label.toLowerCase())}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

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
            <AIInsights
              transactions={filteredTransactions}
              previousPeriodTransactions={[]}
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

        {/* New Analysis Tab */}
        {activeTab === 'analysis' && (
          <View>
            {/* Forecast Card */}
            <LinearGradient colors={['#6366f1', '#4f46e5']} className="rounded-3xl p-6 mb-6 shadow-lg">
              <Text className="text-white/80 font-bold mb-2">{t('forecastNextMonth')}</Text>
              <View className="flex-row justify-between">
                <View>
                  <Text className="text-white/60 text-xs">Est. Income</Text>
                  <Text className="text-white text-2xl font-bold">
                    {formatCurrency(forecast.income)}
                  </Text>
                </View>
                <View className="items-end">
                  <Text className="text-white/60 text-xs">Est. Expense</Text>
                  <Text className="text-white text-2xl font-bold">
                    {formatCurrency(forecast.expense)}
                  </Text>
                </View>
              </View>
              <Text className="text-white/50 text-xs mt-2 italic">
                {t('basedOn3MonthAverage')}
              </Text>
            </LinearGradient>

            {/* Historical Analysis */}
            <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-slate-100 dark:border-slate-700">
              <Text className={`text-slate-900 dark:text-white ${sectionTitleSize} font-bold mb-4`}>{t('historicalAnalysis')}</Text>

              <View className="mb-4">
                <Text className="text-slate-500 text-xs uppercase font-bold mb-2">Income Highlights</Text>
                <View className="flex-row justify-between bg-green-50 dark:bg-green-900/10 p-3 rounded-xl mb-2">
                  <Text className="text-slate-700 dark:text-slate-300">Highest Month</Text>
                  <View className="items-end">
                    <Text className="font-bold text-green-600">{formatCurrency(analysisStats.maxIncome.amount)}</Text>
                    <Text className="text-xs text-slate-500">{analysisStats.maxIncome.month}</Text>
                  </View>
                </View>
                <View className="flex-row justify-between bg-red-50 dark:bg-red-900/10 p-3 rounded-xl">
                  <Text className="text-slate-700 dark:text-slate-300">Lowest Month</Text>
                  <View className="items-end">
                    <Text className="font-bold text-slate-600">{formatCurrency(analysisStats.minIncome.amount)}</Text>
                    <Text className="text-xs text-slate-500">{analysisStats.minIncome.month}</Text>
                  </View>
                </View>
              </View>

              <View>
                <Text className="text-slate-500 text-xs uppercase font-bold mb-2">Expense Highlights</Text>
                <View className="flex-row justify-between bg-green-50 dark:bg-green-900/10 p-3 rounded-xl mb-2">
                  <Text className="text-slate-700 dark:text-slate-300">Lowest Month</Text>
                  <View className="items-end">
                    <Text className="font-bold text-green-600">{formatCurrency(analysisStats.minExpense.amount)}</Text>
                    <Text className="text-xs text-slate-500">{analysisStats.minExpense.month}</Text>
                  </View>
                </View>
                <View className="flex-row justify-between bg-red-50 dark:bg-red-900/10 p-3 rounded-xl mb-2">
                  <Text className="text-slate-700 dark:text-slate-300">Highest Month</Text>
                  <View className="items-end">
                    <Text className="font-bold text-red-600">{formatCurrency(analysisStats.maxExpense.amount)}</Text>
                    <Text className="text-xs text-slate-500">{analysisStats.maxExpense.month}</Text>
                  </View>
                </View>
                <View className="flex-row justify-between bg-slate-50 dark:bg-slate-800 p-3 rounded-xl border border-slate-100 dark:border-slate-700">
                  <Text className="text-slate-700 dark:text-slate-300">{t('avgMonthlyExpense')}</Text>
                  <Text className="font-bold text-slate-900 dark:text-white">{formatCurrency(analysisStats.avgMonthlyExpense)}</Text>
                </View>
              </View>
            </View>

            {/* 6 Month History Chart */}
            <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-slate-100 dark:border-slate-700">
              <Text className={`text-slate-900 dark:text-white ${sectionTitleSize} font-bold mb-4`}>{t('pastSixMonths')}</Text>
              {monthlyData.length > 0 ? (
                <BarChart
                  data={{
                    labels: monthlyData.slice(-6).map(m => m.date.toLocaleDateString('en-US', { month: 'short' })),
                    datasets: [{
                      data: monthlyData.slice(-6).map(m => m.expense),
                    }]
                  }}
                  width={screenWidth - 80}
                  height={220}
                  yAxisLabel=""
                  yAxisSuffix="$"
                  chartConfig={{
                    ...chartConfig,
                    color: (opacity = 1) => `rgba(239, 68, 68, ${opacity})`,
                  }}
                  style={{ borderRadius: 16 }}
                />
              ) : <Text className="text-center text-slate-400">{t('noSufficientData')}</Text>}
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
                  data: [summary.savingsRate / 100, 0.75],
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
    </View>
  );
}
