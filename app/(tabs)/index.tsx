// DrawerMenu moved to AppShell — no local import
import RecentTransactions from '@/components/dashboard/RecentTransactions';
import SummaryCard from '@/components/dashboard/SummaryCard';
import { useAppSettings } from '@/contexts/AppSettingsContext';
import { useAuth } from '@/contexts/AuthContext';
import { useI18n } from '@/contexts/I18nContext';
import { useTheme } from '@/contexts/ThemeContext';
import SyncService from '@/services/SyncService';
import { RootState } from '@/store';
import { fetchAccounts } from '@/store/slices/accountsSlice';
import { fetchBudgets } from '@/store/slices/budgetsSlice';
import { fetchLoans } from '@/store/slices/loansSlice';
import { fetchTransactions } from '@/store/slices/transactionsSlice';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';

export default function DashboardScreen() {
  const router = useRouter();
  const dispatch = useDispatch();
  const { user } = useAuth();
  const { formatCurrency, fontSize } = useAppSettings();
  const { actualTheme } = useTheme();
  const { t } = useI18n();
  const { items: transactions, loading } = useSelector((state: RootState) => state.transactions);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    // @ts-ignore
    dispatch(fetchTransactions());
    // @ts-ignore
    dispatch(fetchAccounts());
    // @ts-ignore
    dispatch(fetchBudgets());
    // @ts-ignore
    dispatch(fetchLoans());

    // Run AI Insights Check
    import('@/services/AppNotificationService').then(({ AppNotificationService }) => {
      AppNotificationService.checkAll();
    });
  }, [dispatch]);

  const handleRefresh = async () => {
    if (!user?.uid) {
      console.warn('No user UID, skipping refresh');
      return;
    }

    setRefreshing(true);

    // Create a timeout promise that rejects after 60 seconds (for slow Android DB)
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Refresh timeout after 60s')), 60000);
    });

    try {
      await Promise.race([
        SyncService.pullAllForUser(user.uid),
        timeoutPromise
      ]);
      console.log('Manual refresh completed successfully');
    } catch (error) {
      console.error('Manual refresh failed:', error);
    } finally {
      setRefreshing(false);
    }
  };

  // Calculate totals
  // Calculate totals and percentage change
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  const income = transactions
    .filter(t => t.type === 'INCOME')
    .reduce((acc, curr) => acc + curr.amount, 0);

  const expense = transactions
    .filter(t => t.type === 'EXPENSE')
    .reduce((acc, curr) => acc + curr.amount, 0);

  const balance = income - expense;

  // Calculate percentage change (Month over Month growth of Total Balance)
  const thisMonthTransactions = transactions.filter(t => t.date >= startOfMonth);
  const thisMonthIncome = thisMonthTransactions
    .filter(t => t.type === 'INCOME')
    .reduce((acc, curr) => acc + curr.amount, 0);
  const thisMonthExpense = thisMonthTransactions
    .filter(t => t.type === 'EXPENSE')
    .reduce((acc, curr) => acc + curr.amount, 0);

  const thisMonthNet = thisMonthIncome - thisMonthExpense;
  const prevBalance = balance - thisMonthNet;

  let percentageChange = 0;
  if (prevBalance === 0) {
    percentageChange = thisMonthNet > 0 ? 100 : 0;
  } else {
    percentageChange = ((balance - prevBalance) / Math.abs(prevBalance)) * 100;
  }

  // Get recent transactions (top 5)
  const recentTransactions = [...transactions]
    .sort((a, b) => b.date - a.date)
    .slice(0, 5);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return t('greetingMorning');
    if (hour < 17) return t('greetingAfternoon');
    return t('greetingEvening');
  };

  const headerTitleSize = fontSize === 'Small' ? 'text-lg' : fontSize === 'Large' ? 'text-2xl' : 'text-xl';
  const sectionTitleSize = fontSize === 'Small' ? 'text-base' : fontSize === 'Large' ? 'text-xl' : 'text-lg';

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
                <FontAwesome name="refresh" size={22} color="#fff" />
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
                className="flex-1 items-center bg-white dark:bg-slate-800 p-3 rounded-2xl mr-3 shadow-sm border border-slate-100 dark:border-slate-700"
                style={{ elevation: 2 }}
                onPress={() => router.push('/modal')}
              >
                <LinearGradient
                  colors={actualTheme === 'dark' ? ['#0f766e', '#134e4a'] : ['#2dd4bf', '#0d9488']}
                  className="w-12 h-12 rounded-xl justify-center items-center mb-2 shadow-lg"
                >
                  <FontAwesome name="plus" size={18} color="#fff" />
                </LinearGradient>
                <Text className="text-slate-900 dark:text-white text-[10px] font-bold">{t('addNew')}</Text>
              </TouchableOpacity>

              <TouchableOpacity className="flex-1 items-center bg-white dark:bg-slate-800 p-3 rounded-2xl mr-3 shadow-sm border border-slate-100 dark:border-slate-700" style={{ elevation: 2 }} onPress={() => router.push('/recurring')}>
                <LinearGradient
                  colors={actualTheme === 'dark' ? ['#c2410c', '#7c2d12'] : ['#fb923c', '#ea580c']}
                  className="w-12 h-12 rounded-xl justify-center items-center mb-2 shadow-lg"
                >
                  <FontAwesome name="repeat" size={18} color="#fff" />
                </LinearGradient>
                <Text className="text-slate-900 dark:text-white text-[10px] font-bold">{t('recurring')}</Text>
              </TouchableOpacity>

              <TouchableOpacity className="flex-1 items-center bg-white dark:bg-slate-800 p-3 rounded-2xl mr-3 shadow-sm border border-slate-100 dark:border-slate-700" style={{ elevation: 2 }} onPress={() => router.push('/budget')}>
                <LinearGradient
                  colors={actualTheme === 'dark' ? ['#7e22ce', '#581c87'] : ['#c084fc', '#9333ea']}
                  className="w-12 h-12 rounded-xl justify-center items-center mb-2 shadow-lg"
                >
                  <FontAwesome name="pie-chart" size={18} color="#fff" />
                </LinearGradient>
                <Text className="text-slate-900 dark:text-white text-[10px] font-bold">{t('budget')}</Text>
              </TouchableOpacity>

              <TouchableOpacity className="flex-1 items-center bg-white dark:bg-slate-800 p-3 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700" style={{ elevation: 2 }} onPress={() => router.push('/(tabs)/reports')}>
                <LinearGradient
                  colors={actualTheme === 'dark' ? ['#4338ca', '#312e81'] : ['#818cf8', '#4f46e5']}
                  className="w-12 h-12 rounded-xl justify-center items-center mb-2 shadow-lg"
                >
                  <FontAwesome name="bar-chart" size={18} color="#fff" />
                </LinearGradient>
                <Text className="text-slate-900 dark:text-white text-[10px] font-bold">{t('reports')}</Text>
              </TouchableOpacity>
            </View>

            {/* Second Row */}
            <View className="flex-row justify-between mt-3">
              <TouchableOpacity className="flex-1 items-center bg-white dark:bg-slate-800 p-3 rounded-2xl mr-3 shadow-sm border border-slate-100 dark:border-slate-700" style={{ elevation: 2 }} onPress={() => router.push('/loans')}>
                <LinearGradient
                  colors={actualTheme === 'dark' ? ['#b91c1c', '#7f1d1d'] : ['#f87171', '#dc2626']}
                  className="w-12 h-12 rounded-xl justify-center items-center mb-2 shadow-lg"
                >
                  <FontAwesome name="money" size={18} color="#fff" />
                </LinearGradient>
                <Text className="text-slate-900 dark:text-white text-[10px] font-bold">{t('loans')}</Text>
              </TouchableOpacity>

              <TouchableOpacity className="flex-1 items-center bg-white dark:bg-slate-800 p-3 rounded-2xl mr-3 shadow-sm border border-slate-100 dark:border-slate-700" style={{ elevation: 2 }} onPress={() => router.push('/calculator')}>
                <LinearGradient
                  colors={actualTheme === 'dark' ? ['#0f766e', '#134e4a'] : ['#2dd4bf', '#0d9488']}
                  className="w-12 h-12 rounded-xl justify-center items-center mb-2 shadow-lg"
                >
                  <FontAwesome name="calculator" size={18} color="#fff" />
                </LinearGradient>
                <Text className="text-slate-900 dark:text-white text-[10px] font-bold">{t('calculator')}</Text>
              </TouchableOpacity>

              <TouchableOpacity className="flex-1 items-center bg-white dark:bg-slate-800 p-3 rounded-2xl mr-3 shadow-sm border border-slate-100 dark:border-slate-700" style={{ elevation: 2 }} onPress={() => router.push('/settings')}>
                <LinearGradient
                  colors={actualTheme === 'dark' ? ['#334155', '#0f172a'] : ['#94a3b8', '#475569']}
                  className="w-12 h-12 rounded-xl justify-center items-center mb-2 shadow-lg"
                >
                  <FontAwesome name="cog" size={18} color="#fff" />
                </LinearGradient>
                <Text className="text-slate-900 dark:text-white text-[10px] font-bold">{t('settings')}</Text>
              </TouchableOpacity>

              <TouchableOpacity className="flex-1 items-center bg-white dark:bg-slate-800 p-3 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700" style={{ elevation: 2 }} onPress={() => router.push('/accounts')}>
                <LinearGradient
                  colors={actualTheme === 'dark' ? ['#0e7490', '#164e63'] : ['#22d3ee', '#0891b2']}
                  className="w-12 h-12 rounded-xl justify-center items-center mb-2 shadow-lg"
                >
                  <FontAwesome name="credit-card" size={18} color="#fff" />
                </LinearGradient>
                <Text className="text-slate-900 dark:text-white text-[10px] font-bold">{t('accounts')}</Text>
              </TouchableOpacity>
            </View>
          </View>

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
