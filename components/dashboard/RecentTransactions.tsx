import { BUNDLED_LOGOS } from '@/assets/bankLogos/et';
import CategoryIcon from '@/components/CategoryIcon';
import { useTransactions } from '@/context/TransactionContext';
import { useAppSettings } from '@/contexts/AppSettingsContext';
import { RootState } from '@/store';
import { Transaction } from '@/types/database';
import { FontAwesome } from '@expo/vector-icons';
import React, { useCallback, useMemo } from 'react';
import { Image, Text, TouchableOpacity, View } from 'react-native';
import { useSelector } from 'react-redux';

// Build once at module load — avoids O(n) find() inside render
const BUNDLED_LOGO_MAP = new Map(BUNDLED_LOGOS.map(b => [b.url, b]));

function resolveLogoSrc(src: any): any {
  if (typeof src === 'number') return src;
  if (typeof src === 'string') return { uri: src };
  if (src?.uri) return src;
  if (src?.default) return { uri: src.default };
  return src;
}

interface RecentTransactionsProps {
  transactions: Transaction[];
  onSeeAll: () => void;
  onTransactionPress?: (transaction: Transaction) => void;
}

function RecentTransactions({ transactions, onSeeAll, onTransactionPress }: RecentTransactionsProps) {
  const { categories } = useTransactions();
  const { formatCurrency } = useAppSettings();
  const accounts = useSelector((state: RootState) => state.accounts.items);

  const categoryMap = useMemo(() => new Map(categories.map(c => [c.name, c])), [categories]);
  const accountMap = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts]);

  // Pre-resolve logo sources for the visible accounts only (O(accounts) not O(accounts × logos))
  const logoSourceMap = useMemo(() => {
    const map = new Map<string, any>();
    accounts.forEach(a => {
      if (!a.logo) return;
      const bundled = BUNDLED_LOGO_MAP.get(a.logo);
      map.set(a.logo, bundled?.src ? resolveLogoSrc(bundled.src) : { uri: a.logo });
    });
    return map;
  }, [accounts]);

  const formatDate = useCallback((timestamp: number) => {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return `Today, ${date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
    } else if (date.toDateString() === yesterday.toDateString()) {
      return `Yesterday, ${date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
  }, []);

  return (
    <View className="mb-8">
      <View className="flex-row justify-between items-center mb-4">
        <Text className="text-slate-900 dark:text-white text-lg font-bold">Recent Transactions</Text>
        <TouchableOpacity onPress={onSeeAll}>
          <Text className="text-primary-500 text-sm font-bold">See All →</Text>
        </TouchableOpacity>
      </View>

      {transactions.length === 0 ? (
        <View className="bg-white dark:bg-slate-800 rounded-2xl p-8 items-center border border-slate-100 dark:border-slate-700">
          <FontAwesome name="inbox" size={48} color="#cbd5e1" />
          <Text className="text-slate-500 mt-4 text-sm dark:text-slate-400">No transactions yet</Text>
          <Text className="text-slate-500 text-xs mt-1 dark:text-slate-400">Add your first transaction to get started</Text>
        </View>
      ) : (
        transactions.map((item) => {
          const isIncome = item.type === 'INCOME';
          const category = categoryMap.get(item.category);
          const account = accountMap.get(item.account_id);

          return (
            <TouchableOpacity
              key={item.id}
              onPress={() => onTransactionPress && onTransactionPress(item)}
              activeOpacity={0.7}
              className="flex-row items-center bg-white dark:bg-slate-800 p-4 rounded-2xl mb-3 shadow-sm border border-slate-100 dark:border-slate-700"
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
                {account?.logo && (
                  <View className="absolute -bottom-2 -left-2 w-9 h-9 bg-slate-100 dark:bg-slate-700 rounded-full justify-center items-center shadow-sm border border-white dark:border-slate-800 z-10 overflow-hidden">
                    <FontAwesome name="bank" size={12} color="#94a3b8" style={{ position: 'absolute' }} />
                    <Image
                      source={logoSourceMap.get(account.logo) as any}
                      className="w-full h-full"
                      resizeMode="cover"
                    />
                  </View>
                )}
              </View>
              <View className="flex-1">
                <Text className="text-slate-900 dark:text-white font-bold text-base mb-1">{item.description}</Text>
                <Text className="text-slate-500 text-xs dark:text-slate-400">{formatDate(item.date)}</Text>
              </View>
              <View className="items-end">
                <Text className={`font-bold text-lg ${isIncome ? 'text-green-600' : 'text-red-500'}`}>
                  {isIncome ? '+' : '-'}{formatCurrency(item.amount)}
                </Text>
                <Text className="text-slate-500 text-xs mt-1 dark:text-slate-400">{item.category}</Text>
              </View>
            </TouchableOpacity>
          );
        })
      )}
    </View>
  );
}

export default React.memo(RecentTransactions);
