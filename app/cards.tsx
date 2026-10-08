import ScreenInfoCard from '@/components/ScreenInfoCard';
import { useAppSettings } from '@/contexts/AppSettingsContext';
import { useLedgerClock } from '@/hooks/useLedgerClock';
import { RootState } from '@/store';
import { fetchAccounts } from '@/store/slices/accountsSlice';
import { fetchTransactions } from '@/store/slices/transactionsSlice';
import type { AppDispatch } from '@/store';
import { accountDelta, sumMoney } from '@/utils/finance';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from '@/components/aurora/AuroraGradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useState } from 'react';
import { Dimensions, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';

const cardWidth = Dimensions.get('window').width - 48;

// Deterministic per-card gradient, so a card keeps its colour between visits.
const PALETTES: [string, string][] = [
  ['#6366f1', '#8b5cf6'],
  ['#f59e0b', '#ea580c'],
  ['#10b981', '#14b8a6'],
  ['#0ea5e9', '#2563eb'],
  ['#ec4899', '#be185d'],
];

export default function CardsScreen() {
  const router = useRouter();
  const dispatch = useDispatch<AppDispatch>();
  const { formatCurrency, balancesHidden } = useAppSettings();
  const ledgerNow = useLedgerClock();
  const [selectedCard, setSelectedCard] = useState(0);

  const accounts = useSelector((s: RootState) => s.accounts.items);
  const transactions = useSelector((s: RootState) => s.transactions.items);

  useEffect(() => {
    dispatch(fetchAccounts());
    dispatch(fetchTransactions());
  }, [dispatch]);

  /**
   * Real card and savings accounts from the ledger.
   *
   * This screen used to render three invented cards — "Demo Premium Visa",
   * holder "John Doe", fabricated card numbers, balances and credit limits —
   * behind a drawer entry called "Cards & Accounts". Card numbers, holder
   * names, expiry dates, networks and credit limits are not part of the
   * ledger, so they are gone rather than faked; what is shown is the account's
   * own name, its stored masked number if any, and its real balance.
   */
  const cards = useMemo(() => accounts
    .filter(account => account.type === 'CARD' || account.type === 'SAVINGS')
    .map((account, index) => {
      const digits = (account.account_number ?? '').replace(/\D/g, '');
      return {
        account,
        // Only ever show the tail the user themselves entered.
        masked: digits.length >= 4 ? `•••• •••• •••• ${digits.slice(-4)}` : null,
        palette: PALETTES[index % PALETTES.length],
      };
    }), [accounts]);

  const active = cards[Math.min(selectedCard, Math.max(0, cards.length - 1))];

  // Locked funds are a real ledger concept; a credit limit is not.
  const usage = useMemo(() => {
    if (!active) return null;
    const balance = active.account.balance;
    const locked = active.account.is_locked ? active.account.locked_amount || 0 : 0;
    const available = sumMoney([balance, -locked]);
    return {
      balance,
      locked,
      available,
      lockedShare: balance > 0 ? Math.min(Math.max((locked / balance) * 100, 0), 100) : 0,
    };
  }, [active]);

  const monthSpend = useMemo(() => {
    if (!active) return 0;
    const start = new Date(ledgerNow);
    const monthStart = new Date(start.getFullYear(), start.getMonth(), 1).getTime();
    return sumMoney(transactions
      .filter(t => t.date >= monthStart && t.date <= ledgerNow)
      .map(t => Math.min(0, accountDelta(t, active.account.id)))
      .map(delta => -delta));
  }, [transactions, active, ledgerNow]);

  const hide = (value: number) => (balancesHidden ? '••••••' : formatCurrency(value));

  return (
    <View className="flex-1 bg-slate-50 dark:bg-background-dark">
      <StatusBar style="auto" />

      <View className="px-6 pt-6 pb-4">
        <View className="flex-row justify-between items-center">
          <TouchableOpacity
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            className="w-11 h-11 bg-white dark:bg-slate-800 rounded-xl justify-center items-center shadow-sm"
          >
            <FontAwesome name="arrow-left" size={18} color="#64748b" />
          </TouchableOpacity>
          <Text className="text-slate-900 dark:text-white text-xl font-bold">Cards & Savings</Text>
          {/* This used to be a plus icon with no handler at all. */}
          <TouchableOpacity
            onPress={() => router.push('/accounts')}
            accessibilityRole="button"
            accessibilityLabel="Add or manage accounts"
            className="w-11 h-11 bg-white dark:bg-slate-800 rounded-xl justify-center items-center shadow-sm"
          >
            <FontAwesome name="plus" size={18} color="#64748b" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {cards.length === 0 || !active || !usage ? (
          <View className="px-6">
            <ScreenInfoCard
              icon="credit-card"
              title="No card or savings accounts yet"
              description="Accounts you add as a Card or Savings account appear here with their balance and any amount you have set aside."
              suggestions={[
                'Add an account and choose Card or Savings as its type.',
                'Enter the last four digits if you want the account shown with a masked number.',
                'Lock an amount on an account to keep it out of your spendable balance.',
              ]}
            />
            <TouchableOpacity
              onPress={() => router.push('/accounts')}
              accessibilityRole="button"
              accessibilityLabel="Go to accounts to add one"
              className="bg-primary-500 py-4 rounded-2xl mb-8"
            >
              <Text className="text-white font-bold text-center">Manage accounts</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) => {
                const page = Math.round(e.nativeEvent.contentOffset.x / (cardWidth + 48));
                setSelectedCard(Math.min(Math.max(page, 0), cards.length - 1));
              }}
              className="mb-6"
            >
              {cards.map((item) => (
                <View key={item.account.id} className="px-6 py-4" style={{ width: cardWidth + 48 }}>
                  <LinearGradient
                    colors={item.palette}
                    className="rounded-3xl p-6 shadow-2xl"
                    style={{ width: cardWidth, height: 200, elevation: 8 }}
                  >
                    <View className="flex-row justify-between items-center mb-8">
                      <View className="bg-white/20 px-3 py-1.5 rounded-lg max-w-[70%]">
                        <Text numberOfLines={1} className="text-white text-xs font-bold">{item.account.name}</Text>
                      </View>
                      <View className="bg-white/20 w-10 h-10 rounded-full justify-center items-center">
                        <FontAwesome
                          name={item.account.type === 'SAVINGS' ? 'bank' : 'credit-card'}
                          size={18}
                          color="#fff"
                        />
                      </View>
                    </View>

                    <Text className="text-white text-xl font-bold mb-6 tracking-wider">
                      {item.masked ?? 'No number saved'}
                    </Text>

                    <View className="flex-row justify-between items-end">
                      <View className="flex-1">
                        <Text className="text-white/90 text-xs mb-1">Balance</Text>
                        <Text numberOfLines={1} className="text-white text-sm font-bold">
                          {hide(item.account.balance)}
                        </Text>
                      </View>
                      <View className="bg-white/20 px-3 py-2 rounded-lg">
                        <Text className="text-white text-xs font-bold uppercase">
                          {item.account.type === 'SAVINGS' ? 'Savings' : 'Card'}
                        </Text>
                      </View>
                    </View>
                  </LinearGradient>
                </View>
              ))}
            </ScrollView>

            {cards.length > 1 && (
              <View className="flex-row justify-center mb-6">
                {cards.map((item, index) => (
                  <View
                    key={item.account.id}
                    className={`h-2 rounded-full mx-1 ${index === selectedCard ? 'w-6 bg-primary-500' : 'w-2 bg-slate-300 dark:bg-slate-700'}`}
                  />
                ))}
              </View>
            )}

            <View className="px-6 mb-6">
              <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 shadow-lg border border-slate-100 dark:border-slate-700" style={{ elevation: 4 }}>
                <View className="flex-row justify-between items-center mb-4">
                  <Text className="text-slate-900 dark:text-white text-base font-bold">Set aside</Text>
                  <View className="bg-blue-50 dark:bg-blue-900/30 px-3 py-1.5 rounded-full">
                    <Text className="text-blue-600 dark:text-blue-400 text-xs font-bold">
                      {usage.lockedShare.toFixed(1)}%
                    </Text>
                  </View>
                </View>

                <View className="mb-4">
                  <View className="flex-row justify-between mb-2">
                    <Text className="text-slate-500 dark:text-slate-400 text-sm">Locked</Text>
                    <Text className="text-slate-900 dark:text-white text-sm font-bold">{hide(usage.locked)}</Text>
                  </View>
                  <View className="bg-slate-100 dark:bg-slate-900 h-3 rounded-full overflow-hidden">
                    <View
                      className="h-full rounded-full"
                      style={{ width: `${usage.lockedShare}%`, backgroundColor: '#6366f1' }}
                    />
                  </View>
                  <View className="flex-row justify-between mt-2">
                    <Text className="text-slate-500 text-xs dark:text-slate-400">{hide(0)}</Text>
                    <Text className="text-slate-500 text-xs dark:text-slate-400">{hide(usage.balance)}</Text>
                  </View>
                </View>

                <View className="bg-slate-50 dark:bg-slate-900 p-4 rounded-2xl">
                  <View className="flex-row justify-between items-center">
                    <View className="flex-1">
                      <Text className="text-slate-500 dark:text-slate-400 text-sm mb-1">Available to spend</Text>
                      <Text className="text-slate-900 dark:text-white text-2xl font-bold">{hide(usage.available)}</Text>
                    </View>
                    <FontAwesome
                      name={usage.available >= 0 ? 'check-circle' : 'exclamation-circle'}
                      size={32}
                      color={usage.available >= 0 ? '#10b981' : '#ef4444'}
                    />
                  </View>
                </View>

                <View className="flex-row justify-between mt-4 pt-4 border-t border-slate-100 dark:border-slate-700">
                  <Text className="text-slate-500 dark:text-slate-400 text-sm">Spent this month</Text>
                  <Text className="text-slate-900 dark:text-white text-sm font-bold">{hide(monthSpend)}</Text>
                </View>
              </View>
            </View>

            {/* These were three buttons with no handler. Only the actions the
                app can actually perform are offered. */}
            <View className="px-6 mb-8">
              <Text className="text-slate-900 dark:text-white text-base font-bold mb-4">Quick Actions</Text>
              <View className="flex-row justify-between">
                <QuickAction
                  icon="list-alt"
                  tint="#10b981"
                  background="bg-green-100 dark:bg-green-900/30"
                  label="History"
                  accessibilityLabel={`View transactions for ${active.account.name}`}
                  onPress={() => router.push(`/account/${active.account.id}`)}
                />
                <QuickAction
                  icon="gear"
                  tint="#9333ea"
                  background="bg-purple-100 dark:bg-purple-900/30"
                  label="Edit account"
                  accessibilityLabel={`Edit ${active.account.name}`}
                  onPress={() => router.push('/accounts')}
                  className="mx-3"
                />
                <QuickAction
                  icon="exchange"
                  tint="#3b82f6"
                  background="bg-blue-100 dark:bg-blue-900/30"
                  label="Transfer"
                  accessibilityLabel={`Transfer money from ${active.account.name}`}
                  onPress={() => router.push('/transfer')}
                />
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function QuickAction({
  icon, tint, background, label, accessibilityLabel, onPress, className = '',
}: {
  icon: string; tint: string; background: string; label: string;
  accessibilityLabel: string; onPress: () => void; className?: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      className={`flex-1 items-center bg-white dark:bg-slate-800 p-5 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 ${className}`}
      style={{ elevation: 2 }}
    >
      <View className={`w-12 h-12 ${background} rounded-2xl justify-center items-center mb-2`}>
        <FontAwesome name={icon as any} size={20} color={tint} />
      </View>
      <Text className="text-slate-900 dark:text-white text-xs font-bold text-center">{label}</Text>
    </TouchableOpacity>
  );
}
