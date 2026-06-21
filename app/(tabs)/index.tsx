// DrawerMenu moved to AppShell — no local import
import FinancialPulse from '@/components/dashboard/FinancialPulse';
import RecentTransactions from '@/components/dashboard/RecentTransactions';
import SummaryCard from '@/components/dashboard/SummaryCard';
import { useAppSettings } from '@/contexts/AppSettingsContext';
import { useAuth } from '@/contexts/AuthContext';
import { useI18n } from '@/contexts/I18nContext';
import { useTheme } from '@/contexts/ThemeContext';
import BudgetService from '@/services/BudgetService';
import SyncService from '@/services/SyncService';
import { AppDispatch, RootState } from '@/store';
import { fetchAccounts } from '@/store/slices/accountsSlice';
import { fetchBudgets } from '@/store/slices/budgetsSlice';
import { fetchLoans } from '@/store/slices/loansSlice';
import { fetchTransactions } from '@/store/slices/transactionsSlice';
import LocalChangeEmitter from '@/services/LocalChangeEmitter';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';

export default function DashboardScreen() {
  const router = useRouter();
  const dispatch = useDispatch<AppDispatch>();
  const { user } = useAuth();
  const { fontSize } = useAppSettings();
  const { actualTheme } = useTheme();
  const { t } = useI18n();
  const { items: transactions } = useSelector((state: RootState) => state.transactions);
  const { items: accounts } = useSelector((state: RootState) => state.accounts);
  const { items: budgets } = useSelector((state: RootState) => state.budgets);
  const { items: loans } = useSelector((state: RootState) => state.loans);
  const [refreshing, setRefreshing] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-fetch accounts whenever local SQLite data changes (e.g. after adding a transaction,
  // the balance is recalculated in SQLite but Redux accounts slice is not updated automatically)
  useEffect(() => {
    const unsub = LocalChangeEmitter.subscribe(() => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => {
        dispatch(fetchAccounts());
        dispatch(fetchTransactions());
      }, 300);
    });
    return () => {
      unsub();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [dispatch]);

  useEffect(() => {
    dispatch(fetchTransactions());
    dispatch(fetchAccounts());
    dispatch(fetchBudgets());
    dispatch(fetchLoans());

    // Run AI Insights Check
    import('@/services/AppNotificationService').then(({ AppNotificationService }) => {
      AppNotificationService.checkAll();
    });
  }, [dispatch]);

  const handleRefresh = async () => {
    setRefreshing(true);

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Refresh timeout after 60s')), 60000);
    });

    try {
      await Promise.race([
        SyncService.syncNow(user?.uid),
        timeoutPromise
      ]);
      console.log('Manual refresh completed successfully');
    } catch (error) {
      console.error('Manual refresh failed:', error);
    } finally {
      setRefreshing(false);
    }
  };

  // Stable per-mount timestamps (avoids deps changing on every render)
  const nowTs = useMemo(() => Date.now(), []);
  const startOfMonth = useMemo(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1).getTime();
  }, []);

  const income = useMemo(
    () => transactions.filter(t => t.type === 'INCOME').reduce((acc, curr) => acc + curr.amount, 0),
    [transactions]
  );
  const expense = useMemo(
    () => transactions.filter(t => t.type === 'EXPENSE').reduce((acc, curr) => acc + curr.amount, 0),
    [transactions]
  );
  const balance = useMemo(
    () => accounts.reduce((sum, account) => sum + account.balance, 0),
    [accounts]
  );
  const thisMonthTransactions = useMemo(
    () => transactions.filter(t => t.date >= startOfMonth),
    [transactions, startOfMonth]
  );
  const thisMonthIncome = useMemo(
    () => thisMonthTransactions.filter(t => t.type === 'INCOME').reduce((acc, curr) => acc + curr.amount, 0),
    [thisMonthTransactions]
  );
  const thisMonthExpense = useMemo(
    () => thisMonthTransactions.filter(t => t.type === 'EXPENSE').reduce((acc, curr) => acc + curr.amount, 0),
    [thisMonthTransactions]
  );
  const thisMonthNet = thisMonthIncome - thisMonthExpense;
  const prevBalance = balance - thisMonthNet;
  const monthlySavingsRate = thisMonthIncome > 0 ? (thisMonthNet / thisMonthIncome) * 100 : 0;
  const percentageChange = useMemo(() => {
    if (prevBalance === 0) return thisMonthNet > 0 ? 100 : 0;
    return ((balance - prevBalance) / Math.abs(prevBalance)) * 100;
  }, [balance, prevBalance, thisMonthNet]);
  const topExpenseCategoryEntry = useMemo(() => {
    const totals = thisMonthTransactions
      .filter(t => t.type === 'EXPENSE')
      .reduce((acc, t) => {
        const key = t.category || 'Uncategorized';
        acc[key] = (acc[key] || 0) + t.amount;
        return acc;
      }, {} as Record<string, number>);
    return Object.entries(totals).sort((l, r) => r[1] - l[1])[0];
  }, [thisMonthTransactions]);
  const { overBudgetCount, nearBudgetCount } = useMemo(() => {
    const active = budgets.filter(b => b.start_date <= nowTs && b.end_date >= nowTs);
    const metrics = active.length > 0
      ? BudgetService.calculateBudgetCollectionMetrics(active, budgets, transactions)
      : [];
    return {
      overBudgetCount: metrics.filter(m => m.remaining < 0).length,
      nearBudgetCount: metrics.filter(m => m.remaining >= 0 && m.progress >= 85).length,
    };
  }, [budgets, transactions, nowTs]);
  const dueSoonLoanCount = useMemo(
    () => loans.filter(l =>
      l.status === 'ACTIVE' &&
      l.type === 'BORROWED' &&
      l.due_date >= nowTs &&
      l.due_date <= nowTs + (7 * 24 * 60 * 60 * 1000)
    ).length,
    [loans, nowTs]
  );
  const recentTransactions = useMemo(
    () => [...transactions].sort((a, b) => b.date - a.date).slice(0, 5),
    [transactions]
  );

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return t('greetingMorning');
    if (hour < 17) return t('greetingAfternoon');
    return t('greetingEvening');
  };

  const isVerySmall = fontSize === 'V.Small';
  const headerTitleSize = fontSize === 'V.Small' ? 'text-base' : fontSize === 'Small' ? 'text-lg' : fontSize === 'Large' ? 'text-2xl' : 'text-xl';
  const sectionTitleSize = fontSize === 'V.Small' ? 'text-sm' : fontSize === 'Small' ? 'text-base' : fontSize === 'Large' ? 'text-xl' : 'text-lg';
  const quickActionCardClass = `flex-1 items-center bg-white dark:bg-slate-800 ${isVerySmall ? 'p-2.5' : 'p-3'} rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700`;
  const quickActionIconWrapClass = `${isVerySmall ? 'w-10 h-10 mb-1.5' : 'w-12 h-12 mb-2'} rounded-xl justify-center items-center shadow-lg`;
  const quickActionLabelClass = `text-slate-900 dark:text-white ${isVerySmall ? 'text-[9px]' : 'text-[10px]'} font-bold`;

  return (
    <View className="flex-1 bg-slate-50 dark:bg-background-dark">
      <StatusBar style="auto" />
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={['#4f46e5']}
            tintColor={actualTheme === 'dark' ? '#fff' : '#4f46e5'}
          />
        }
      >
        {/* Header with gradient background */}
        <LinearGradient
          colors={actualTheme === 'dark' ? ['#334155', '#1e293b'] : ['#4f46e5', '#4338ca']}
          className="px-6 pt-6 pb-32 rounded-b-[40px]"
          style={{ elevation: 4 }}
        >
          <View className="flex-row justify-between items-center mb-8">
            <View className="w-12 h-12" />
            <View className="flex-1 items-center">
              <Text className="text-primary-100 text-sm font-medium">{getGreeting()}</Text>
              <Text className={`text-white ${headerTitleSize} font-bold mt-1`}>{t('welcomeBack')}</Text>
            </View>
            <TouchableOpacity
              onPress={handleRefresh}
              disabled={refreshing}
              className="w-12 h-12 items-center justify-center"
            >
              {refreshing ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <FontAwesome name="refresh" size={isVerySmall ? 20 : 22} color="#fff" />
              )}
            </TouchableOpacity>
          </View>

          {/* Balance Card - Floating */}
          <SummaryCard balance={balance} income={income} expense={expense} percentageChange={percentageChange} />
        </LinearGradient>

        {/* Content Section */}
        <View className="px-6 -mt-20">
          {/* Quick Actions */}
          <View className="mb-8">
            <Text className={`text-white ${sectionTitleSize} font-bold mb-4`}>{t('quickActions')}</Text>
            <View className="flex-row justify-between">
              <TouchableOpacity
                className={`${quickActionCardClass} mr-3`}
                style={{ elevation: 2 }}
                onPress={() => router.push('/modal')}
              >
                <LinearGradient
                  colors={actualTheme === 'dark' ? ['#0f766e', '#134e4a'] : ['#2dd4bf', '#0d9488']}
                  className={quickActionIconWrapClass}
                >
                  <FontAwesome name="plus" size={isVerySmall ? 16 : 18} color="#fff" />
                </LinearGradient>
                <Text className={quickActionLabelClass}>{t('addNew')}</Text>
              </TouchableOpacity>

              <TouchableOpacity className={`${quickActionCardClass} mr-3`} style={{ elevation: 2 }} onPress={() => router.push('/recurring')}>
                <LinearGradient
                  colors={actualTheme === 'dark' ? ['#c2410c', '#7c2d12'] : ['#fb923c', '#ea580c']}
                  className={quickActionIconWrapClass}
                >
                  <FontAwesome name="repeat" size={isVerySmall ? 16 : 18} color="#fff" />
                </LinearGradient>
                <Text className={quickActionLabelClass}>{t('recurring')}</Text>
              </TouchableOpacity>

              <TouchableOpacity className={`${quickActionCardClass} mr-3`} style={{ elevation: 2 }} onPress={() => router.push('/budget')}>
                <LinearGradient
                  colors={actualTheme === 'dark' ? ['#7e22ce', '#581c87'] : ['#c084fc', '#9333ea']}
                  className={quickActionIconWrapClass}
                >
                  <FontAwesome name="pie-chart" size={isVerySmall ? 16 : 18} color="#fff" />
                </LinearGradient>
                <Text className={quickActionLabelClass}>{t('budget')}</Text>
              </TouchableOpacity>

              <TouchableOpacity className={quickActionCardClass} style={{ elevation: 2 }} onPress={() => router.push('/(tabs)/reports')}>
                <LinearGradient
                  colors={actualTheme === 'dark' ? ['#4338ca', '#312e81'] : ['#818cf8', '#4f46e5']}
                  className={quickActionIconWrapClass}
                >
                  <FontAwesome name="bar-chart" size={isVerySmall ? 16 : 18} color="#fff" />
                </LinearGradient>
                <Text className={quickActionLabelClass}>{t('reports')}</Text>
              </TouchableOpacity>
            </View>

            {/* Second Row */}
            <View className="flex-row justify-between mt-3">
              <TouchableOpacity className={`${quickActionCardClass} mr-3`} style={{ elevation: 2 }} onPress={() => router.push('/loans')}>
                <LinearGradient
                  colors={actualTheme === 'dark' ? ['#b91c1c', '#7f1d1d'] : ['#f87171', '#dc2626']}
                  className={quickActionIconWrapClass}
                >
                  <FontAwesome name="money" size={isVerySmall ? 16 : 18} color="#fff" />
                </LinearGradient>
                <Text className={quickActionLabelClass}>{t('loans')}</Text>
              </TouchableOpacity>

              <TouchableOpacity className={`${quickActionCardClass} mr-3`} style={{ elevation: 2 }} onPress={() => router.push('/calculator')}>
                <LinearGradient
                  colors={actualTheme === 'dark' ? ['#0f766e', '#134e4a'] : ['#2dd4bf', '#0d9488']}
                  className={quickActionIconWrapClass}
                >
                  <FontAwesome name="calculator" size={isVerySmall ? 16 : 18} color="#fff" />
                </LinearGradient>
                <Text className={quickActionLabelClass}>{t('calculator')}</Text>
              </TouchableOpacity>

              <TouchableOpacity className={`${quickActionCardClass} mr-3`} style={{ elevation: 2 }} onPress={() => router.push('/settings')}>
                <LinearGradient
                  colors={actualTheme === 'dark' ? ['#334155', '#0f172a'] : ['#94a3b8', '#475569']}
                  className={quickActionIconWrapClass}
                >
                  <FontAwesome name="cog" size={isVerySmall ? 16 : 18} color="#fff" />
                </LinearGradient>
                <Text className={quickActionLabelClass}>{t('settings')}</Text>
              </TouchableOpacity>

              <TouchableOpacity className={quickActionCardClass} style={{ elevation: 2 }} onPress={() => router.push('/accounts')}>
                <LinearGradient
                  colors={actualTheme === 'dark' ? ['#0e7490', '#164e63'] : ['#22d3ee', '#0891b2']}
                  className={quickActionIconWrapClass}
                >
                  <FontAwesome name="credit-card" size={isVerySmall ? 16 : 18} color="#fff" />
                </LinearGradient>
                <Text className={quickActionLabelClass}>{t('accounts')}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Financial Pulse */}
          <FinancialPulse
            monthlyNet={thisMonthNet}
            savingsRate={monthlySavingsRate}
            overBudgetCount={overBudgetCount}
            nearBudgetCount={nearBudgetCount}
            dueSoonLoanCount={dueSoonLoanCount}
            topExpenseCategoryName={topExpenseCategoryEntry?.[0]}
            topExpenseCategoryAmount={topExpenseCategoryEntry?.[1]}
            onOpenBudget={() => router.push('/budget')}
            onOpenLoans={() => router.push('/loans')}
            onOpenAssistant={() => router.push('/aiassistant')}
          />

          {/* Recent Transactions */}
          <RecentTransactions
            transactions={recentTransactions}
            onSeeAll={() => router.push('/(tabs)/transactions')}
            onTransactionPress={(t) => router.push(`/transaction/${t.id}`)}
          />
        </View>
      </ScrollView>
      {/* Drawer is provided by AppShell */}
    </View>
  );
}
