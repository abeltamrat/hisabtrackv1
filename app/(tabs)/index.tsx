import CoinLoader from '@/components/CoinLoader';
import { useLedgerClock } from '@/hooks/useLedgerClock';
import { sumMoney, operatingIncome, operatingExpense, operatingTransactions, cashDelta } from '@/utils/finance';
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
import { LinearGradient } from '@/components/aurora/AuroraGradient';
import { FUNDS_ENABLED } from '@/config/features';
import FundSyncService, { formatFundMoney } from '@/services/FundSyncService';
import { fundRole } from '@/services/SharedFundService';
import { DraftTransactionService } from '@/services/DraftTransactionService';
import drawerBus from '@/utils/drawerBus';
import Icon3D from '@/components/three-d/Icon3D';
import { formatEthiopianDate } from '@/utils/ethiopianCalendar';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';

// Throttle the AI notification check to once every 10 minutes across mounts (e.g. tab switches)
let lastAICheck = 0;

export default function DashboardScreen() {
  const router = useRouter();
  const dispatch = useDispatch<AppDispatch>();
  const { user } = useAuth();
  const { fontSize, formatCurrency, balancesHidden } = useAppSettings();
  const { actualTheme, isAurora } = useTheme();
  const { t } = useI18n();
  const { items: transactions } = useSelector((state: RootState) => state.transactions);
  const { items: accounts } = useSelector((state: RootState) => state.accounts);
  const { items: budgets } = useSelector((state: RootState) => state.budgets);
  const { items: loans } = useSelector((state: RootState) => state.loans);
  const dataError = useSelector((s: RootState) => s.accounts.error || s.transactions.error || s.budgets.error || s.loans.error);
  // The first fetch arrives after the first render, so without this the card
  // showed a confident 0.00 that then jumped to the real balance.
  const initialLoad = useSelector((s: RootState) =>
    (s.accounts.loading || s.transactions.loading) && s.accounts.items.length === 0 && s.transactions.items.length === 0);
  const [refreshing, setRefreshing] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The Aurora "More" tile is two-stage: the first tap reveals a second row
  // of less-frequent actions in place; only once those are visible does a
  // second tap hand off to the full side menu.
  const [quickActionsExpanded, setQuickActionsExpanded] = useState(false);

  // SMS drafts awaiting review (Aurora quick-action badge). Refreshed on the
  // same local-change signal the rest of the dashboard already listens to.
  const [pendingDraftCount, setPendingDraftCount] = useState(0);
  const refreshDraftCount = useCallback(() => {
    DraftTransactionService.getAll().then(all => setPendingDraftCount(all.filter(d => d.status === 'PENDING').length)).catch(() => {});
  }, []);

  // Funds this user holds for someone else, or that someone else holds for them.
  const [fundSnapshot, setFundSnapshot] = useState(FundSyncService.getSnapshot());
  useEffect(() => {
    if (!FUNDS_ENABLED || !user?.uid) return;
    FundSyncService.start(user.uid);
    return FundSyncService.subscribe(setFundSnapshot);
  }, [user?.uid]);
  const heldForMeFunds = useMemo(
    () => fundSnapshot.funds.filter(f => user?.uid && fundRole(f, user.uid) === 'OWNER' && f.status === 'ACTIVE' && f.linkStatus === 'ACCEPTED'),
    [fundSnapshot.funds, user?.uid]
  );

  // Re-fetch when local SQLite data changes. 600 ms debounce avoids back-to-back dispatches.
  useEffect(() => {
    const unsub = LocalChangeEmitter.subscribe(() => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => {
        dispatch(fetchAccounts());
        dispatch(fetchTransactions());
        refreshDraftCount();
      }, 600);
    });
    return () => {
      unsub();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [dispatch, refreshDraftCount]);

  useEffect(() => {
    dispatch(fetchTransactions());
    dispatch(fetchAccounts());
    dispatch(fetchBudgets());
    dispatch(fetchLoans());
    refreshDraftCount();

    // AI Insights check: throttle to once per 10 min so tab switches don't re-run it
    const now = Date.now();
    if (now - lastAICheck > 10 * 60 * 1000) {
      lastAICheck = now;
      import('@/services/AppNotificationService').then(({ AppNotificationService }) => {
        AppNotificationService.checkAll();
      });
    }
  }, [dispatch, refreshDraftCount]);

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
  const nowTs = useLedgerClock();
  const startOfMonth = useMemo(() => {
    const n = new Date(nowTs);
    return new Date(n.getFullYear(), n.getMonth(), 1).getTime();
  }, [nowTs]);

  const balance = useMemo(
    () => sumMoney(accounts.map(account => account.balance)),
    [accounts]
  );
  const thisMonthTransactions = useMemo(
    () => transactions.filter(t => t.date >= startOfMonth && t.date <= nowTs),
    [transactions, startOfMonth, nowTs]
  );
  const thisMonthIncome = useMemo(
    () => sumMoney(thisMonthTransactions.map(operatingIncome)),
    [thisMonthTransactions]
  );
  const thisMonthExpense = useMemo(
    () => sumMoney(thisMonthTransactions.map(operatingExpense)),
    [thisMonthTransactions]
  );
  const thisMonthNet = thisMonthIncome - thisMonthExpense;
  const prevBalance = balance - sumMoney(thisMonthTransactions.map(cashDelta));
  const monthlySavingsRate = thisMonthIncome > 0 ? (thisMonthNet / thisMonthIncome) * 100 : 0;
  const percentageChange = useMemo(() => {
    if (prevBalance === 0) return thisMonthNet > 0 ? 100 : 0;
    return ((balance - prevBalance) / Math.abs(prevBalance)) * 100;
  }, [balance, prevBalance, thisMonthNet]);
  // Cumulative cash position across the last 14 days, oldest first — feeds the
  // balance card's sparkline. Real ledger deltas, not synthetic data.
  const trendPoints = useMemo(() => {
    const WINDOW_DAYS = 14;
    const dayMs = 24 * 60 * 60 * 1000;
    const windowStart = nowTs - WINDOW_DAYS * dayMs;
    const before = sumMoney(transactions.filter(t => t.date < windowStart).map(cashDelta));
    const inWindow = transactions.filter(t => t.date >= windowStart && t.date <= nowTs);
    let running = before;
    const points: number[] = [running];
    for (let day = 0; day < WINDOW_DAYS; day++) {
      const dayEnd = windowStart + (day + 1) * dayMs;
      const delta = sumMoney(inWindow.filter(t => t.date >= windowStart + day * dayMs && t.date < dayEnd).map(cashDelta));
      running += delta;
      points.push(running);
    }
    return points;
  }, [transactions, nowTs]);
  const topExpenseCategoryEntry = useMemo(() => {
    const totals = operatingTransactions(thisMonthTransactions)
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

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return t('greetingMorning');
    if (hour < 17) return t('greetingAfternoon');
    return t('greetingEvening');
  }, [t]);

  const dateLine = useMemo(() => {
    const gregorian = new Date(nowTs).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    return `${gregorian} · ${formatEthiopianDate(nowTs)}`;
  }, [nowTs]);

  const isVerySmall = fontSize === 'V.Small';
  const { headerTitleSize, sectionTitleSize, quickActionCardClass, quickActionIconWrapClass, quickActionLabelClass } = useMemo(() => ({
    headerTitleSize: fontSize === 'V.Small' ? 'text-base' : fontSize === 'Small' ? 'text-lg' : fontSize === 'Large' ? 'text-2xl' : 'text-xl',
    sectionTitleSize: fontSize === 'V.Small' ? 'text-sm' : fontSize === 'Small' ? 'text-base' : fontSize === 'Large' ? 'text-xl' : 'text-lg',
    quickActionCardClass: `flex-1 items-center bg-white dark:bg-slate-800 ${isVerySmall ? 'p-2.5' : 'p-3'} rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700`,
    quickActionIconWrapClass: `${isVerySmall ? 'w-10 h-10 mb-1.5' : 'w-12 h-12 mb-2'} rounded-xl justify-center items-center shadow-lg`,
    quickActionLabelClass: `text-slate-900 dark:text-white ${isVerySmall ? 'text-[10px]' : 'text-[10px]'} font-bold`,
  }), [fontSize, isVerySmall]);

  type AuroraAction = { key: string; label: string; icon: string; color: string; badge?: number; onPress: () => void };

  // Aurora's quick actions: same destinations as the classic grid, plus
  // Funds and Equb, and an SMS tile carrying the pending-draft badge. Each
  // gets its own Icon3D accent colour, echoing the classic grid's per-tile
  // gradient colours so the two themes feel like the same app.
  const auroraPrimaryActions: AuroraAction[] = [
    { key: 'add', label: t('addNew'), icon: 'plus', color: '#0d9488', onPress: () => router.push('/modal') },
    { key: 'transfer', label: t('transferAction'), icon: 'exchange', color: '#ea580c', onPress: () => router.push('/transfer') },
    { key: 'sms', label: t('smsAction'), icon: 'comment', color: '#e11d48', badge: pendingDraftCount, onPress: () => router.push('/draft-transactions') },
    { key: 'funds', label: t('fundsAction'), icon: 'briefcase', color: '#0891b2', onPress: () => router.push('/funds' as any) },
    { key: 'budget', label: t('budget'), icon: 'pie-chart', color: '#9333ea', onPress: () => router.push('/budget') },
    { key: 'reports', label: t('reports'), icon: 'bar-chart', color: '#4f46e5', onPress: () => router.push('/(tabs)/reports') },
    { key: 'equb', label: t('equbAction'), icon: 'users', color: '#d97706', onPress: () => router.push('/community' as any) },
  ];

  // Less-frequent actions, revealed only once "More" is tapped once — the
  // same destinations the classic grid exposes directly, kept out of the
  // first row so the everyday actions above stay the fastest to reach.
  const auroraMoreActions: AuroraAction[] = [
    { key: 'loans', label: t('loans'), icon: 'line-chart', color: '#ef4444', onPress: () => router.push('/loans') },
    { key: 'recurring', label: t('recurring'), icon: 'refresh', color: '#14b8a6', onPress: () => router.push('/recurring') },
    { key: 'calculator', label: t('calculator'), icon: 'calculator', color: '#f97316', onPress: () => router.push('/calculator') },
    { key: 'accounts', label: t('accounts'), icon: 'bank', color: '#6366f1', onPress: () => router.push('/accounts') },
  ];

  // Tapping "More" the first time reveals auroraMoreActions in place; the
  // tile then switches to a menu glyph, and a second tap opens the full
  // side drawer — the same two-stage reveal the classic grid doesn't need
  // since it already shows every one of these directly.
  const moreTile: AuroraAction = quickActionsExpanded
    ? { key: 'more', label: t('moreAction'), icon: 'bars', color: '#475569', onPress: () => drawerBus.open() }
    : { key: 'more', label: t('moreAction'), icon: 'ellipsis-h', color: '#475569', onPress: () => setQuickActionsExpanded(true) };

  const auroraActions: AuroraAction[] = quickActionsExpanded
    ? [...auroraPrimaryActions, ...auroraMoreActions, moreTile]
    : [...auroraPrimaryActions, moreTile];

  const auroraActionRows: AuroraAction[][] = [];
  for (let i = 0; i < auroraActions.length; i += 4) {
    auroraActionRows.push(auroraActions.slice(i, i + 4));
  }

  return (
    <View className="flex-1 bg-slate-50 dark:bg-background-dark">
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
        {!!dataError && <Text accessibilityRole="alert" style={{ padding: 12, color: '#b91c1c' }}>Data could not be refreshed: {dataError}. Totals may be stale.</Text>}
        {!!SyncService.lastError && <Text accessibilityRole="alert" style={{ padding: 12, color: '#b91c1c' }}>{SyncService.lastError}</Text>}
        {/* Header with gradient background */}
        <LinearGradient
          colors={actualTheme === 'dark' ? ['#334155', '#1e293b'] : ['#4f46e5', '#4338ca']}
          className="px-6 pt-6 pb-32 rounded-b-[40px]"
          style={{ elevation: 4 }}
        >
          <View className="flex-row justify-between items-center mb-8">
            <View className="w-12 h-12" />
            <View className="flex-1 items-center">
              <Text className="text-primary-100 text-sm font-medium">{greeting}</Text>
              {isAurora ? (
                <Text className="text-white/80 text-xs font-medium mt-0.5">{dateLine}</Text>
              ) : (
                <Text className={`text-white ${headerTitleSize} font-bold mt-1`}>{t('welcomeBack')}</Text>
              )}
            </View>
            <TouchableOpacity
              onPress={handleRefresh}
              disabled={refreshing}
              accessibilityRole="button"
              accessibilityLabel="Refresh financial data"
              accessibilityState={{ disabled: refreshing, busy: refreshing }}
              className="w-12 h-12 items-center justify-center"
            >
              {refreshing ? (
                <CoinLoader size="small" color="#fff" />
              ) : (
                <FontAwesome name="refresh" size={isVerySmall ? 20 : 22} color="#fff" />
              )}
            </TouchableOpacity>
          </View>

          {/* Balance Card - Floating */}
          <SummaryCard balance={balance} income={thisMonthIncome} expense={thisMonthExpense} percentageChange={percentageChange} loading={initialLoad} trendPoints={trendPoints} />
        </LinearGradient>

        {/* Content Section */}
        <View className="px-6 -mt-20">
          {isAurora && (accounts.length > 0 || heldForMeFunds.length > 0) && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              // Required on Android for a horizontal scroller nested inside this
              // screen's own vertical ScrollView — without it, drags here were
              // claimed by the outer scroll and this row never moved.
              nestedScrollEnabled
              directionalLockEnabled
              className="mb-5"
              contentContainerStyle={{ gap: 10 }}
            >
              {accounts.map(account => (
                <View key={account.id} className="rounded-2xl px-3.5 py-2.5" style={{ backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' }}>
                  <Text className="text-white/90 text-[11px]" numberOfLines={1}>{account.name}</Text>
                  <Text className="text-white font-extrabold text-sm mt-0.5" numberOfLines={1} adjustsFontSizeToFit>{balancesHidden ? '••••••' : formatCurrency(account.balance)}</Text>
                </View>
              ))}
              {heldForMeFunds.map(fund => (
                <TouchableOpacity
                  key={fund.id}
                  onPress={() => router.push(`/fund/${fund.id}` as any)}
                  accessibilityRole="button"
                  className="rounded-2xl px-3.5 py-2.5"
                  style={{ backgroundColor: 'rgba(103,232,249,0.12)', borderWidth: 1, borderColor: 'rgba(103,232,249,0.35)' }}
                >
                  <Text className="text-cyan-200 text-[11px]" numberOfLines={1}>{t('heldByLabel')} {fund.custodianName}</Text>
                  <Text className="text-white font-extrabold text-sm mt-0.5" numberOfLines={1} adjustsFontSizeToFit>{balancesHidden ? '••••••' : formatFundMoney(fund.balance, fund.currency)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {/* Quick Actions */}
          <View className="mb-8">
            <Text className={`text-white ${sectionTitleSize} font-bold mb-4`}>{t('quickActions')}</Text>

            {isAurora ? (
              // Explicit rows of exactly 4, the same technique the classic grid
              // below uses — a percentage width inside flex-wrap previously
              // landed on 3 columns instead of 4 on some screen widths, making
              // the grid a row taller than intended and pushing it into the
              // floating assistant button.
              <View style={{ gap: 10 }}>
                {auroraActionRows.map((row, rowIndex) => (
                  <View key={rowIndex} className="flex-row justify-between">
                    {row.map(action => (
                      <TouchableOpacity
                        key={action.key}
                        onPress={action.onPress}
                        accessibilityRole="button"
                        accessibilityLabel={action.label}
                        className="flex-1 items-center py-1"
                      >
                        <View style={{ position: 'relative' }}>
                          <Icon3D icon={action.icon as any} color={action.color} size={isVerySmall ? 48 : 54} iconSize={isVerySmall ? 18 : 20} />
                          {!!action.badge && (
                            <View style={{ position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: '#fb7185', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
                              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{action.badge}</Text>
                            </View>
                          )}
                        </View>
                        <Text className="text-white text-[11px] font-semibold mt-1.5" numberOfLines={1}>{action.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ))}
              </View>
            ) : (
              <>
            <View className="flex-row justify-between">
              <TouchableOpacity
                className={`${quickActionCardClass} mr-3`}
                style={{ elevation: 2 }}
                onPress={() => router.push('/modal')}
                accessibilityRole="button"
                accessibilityLabel={t('addNew')}
                accessibilityHint="Opens the form to record a new transaction"
              >
                <LinearGradient
                  colors={actualTheme === 'dark' ? ['#0f766e', '#134e4a'] : ['#2dd4bf', '#0d9488']}
                  className={quickActionIconWrapClass}
                >
                  <FontAwesome name="plus" size={isVerySmall ? 16 : 18} color="#fff" />
                </LinearGradient>
                <Text className={quickActionLabelClass}>{t('addNew')}</Text>
              </TouchableOpacity>

              <TouchableOpacity className={`${quickActionCardClass} mr-3`} style={{ elevation: 2 }} onPress={() => router.push('/recurring')}
                accessibilityRole="button"
                accessibilityLabel={t('recurring')}>
                <LinearGradient
                  colors={actualTheme === 'dark' ? ['#c2410c', '#7c2d12'] : ['#fb923c', '#ea580c']}
                  className={quickActionIconWrapClass}
                >
                  <FontAwesome name="repeat" size={isVerySmall ? 16 : 18} color="#fff" />
                </LinearGradient>
                <Text className={quickActionLabelClass}>{t('recurring')}</Text>
              </TouchableOpacity>

              <TouchableOpacity className={`${quickActionCardClass} mr-3`} style={{ elevation: 2 }} onPress={() => router.push('/budget')}
                accessibilityRole="button"
                accessibilityLabel={t('budget')}>
                <LinearGradient
                  colors={actualTheme === 'dark' ? ['#7e22ce', '#581c87'] : ['#c084fc', '#9333ea']}
                  className={quickActionIconWrapClass}
                >
                  <FontAwesome name="pie-chart" size={isVerySmall ? 16 : 18} color="#fff" />
                </LinearGradient>
                <Text className={quickActionLabelClass}>{t('budget')}</Text>
              </TouchableOpacity>

              <TouchableOpacity className={quickActionCardClass} style={{ elevation: 2 }} onPress={() => router.push('/(tabs)/reports')}
                accessibilityRole="button"
                accessibilityLabel={t('reports')}>
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
              <TouchableOpacity className={`${quickActionCardClass} mr-3`} style={{ elevation: 2 }} onPress={() => router.push('/loans')}
                accessibilityRole="button"
                accessibilityLabel={t('loans')}>
                <LinearGradient
                  colors={actualTheme === 'dark' ? ['#b91c1c', '#7f1d1d'] : ['#f87171', '#dc2626']}
                  className={quickActionIconWrapClass}
                >
                  <FontAwesome name="money" size={isVerySmall ? 16 : 18} color="#fff" />
                </LinearGradient>
                <Text className={quickActionLabelClass}>{t('loans')}</Text>
              </TouchableOpacity>

              <TouchableOpacity className={`${quickActionCardClass} mr-3`} style={{ elevation: 2 }} onPress={() => router.push('/calculator')}
                accessibilityRole="button"
                accessibilityLabel={t('calculator')}>
                <LinearGradient
                  colors={actualTheme === 'dark' ? ['#0f766e', '#134e4a'] : ['#2dd4bf', '#0d9488']}
                  className={quickActionIconWrapClass}
                >
                  <FontAwesome name="calculator" size={isVerySmall ? 16 : 18} color="#fff" />
                </LinearGradient>
                <Text className={quickActionLabelClass}>{t('calculator')}</Text>
              </TouchableOpacity>

              <TouchableOpacity className={`${quickActionCardClass} mr-3`} style={{ elevation: 2 }} onPress={() => router.push('/settings')}
                accessibilityRole="button"
                accessibilityLabel={t('settings')}>
                <LinearGradient
                  colors={actualTheme === 'dark' ? ['#334155', '#0f172a'] : ['#94a3b8', '#475569']}
                  className={quickActionIconWrapClass}
                >
                  <FontAwesome name="cog" size={isVerySmall ? 16 : 18} color="#fff" />
                </LinearGradient>
                <Text className={quickActionLabelClass}>{t('settings')}</Text>
              </TouchableOpacity>

              <TouchableOpacity className={quickActionCardClass} style={{ elevation: 2 }} onPress={() => router.push('/accounts')}
                accessibilityRole="button"
                accessibilityLabel={t('accounts')}>
                <LinearGradient
                  colors={actualTheme === 'dark' ? ['#0e7490', '#164e63'] : ['#22d3ee', '#0891b2']}
                  className={quickActionIconWrapClass}
                >
                  <FontAwesome name="credit-card" size={isVerySmall ? 16 : 18} color="#fff" />
                </LinearGradient>
                <Text className={quickActionLabelClass}>{t('accounts')}</Text>
              </TouchableOpacity>
            </View>
              </>
            )}
          </View>

          {/* Financial Pulse */}
          <FinancialPulse
            monthlyNet={thisMonthNet}
            balancesHidden={balancesHidden}
            savingsRate={monthlySavingsRate}
            overBudgetCount={overBudgetCount}
            nearBudgetCount={nearBudgetCount}
            dueSoonLoanCount={dueSoonLoanCount}
            topExpenseCategoryName={topExpenseCategoryEntry?.[0]}
            topExpenseCategoryAmount={topExpenseCategoryEntry?.[1]}
            hasData={accounts.length > 0 || transactions.length > 0}
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
