import { BUNDLED_LOGOS } from '@/assets/bankLogos/et';
import CategoryIcon from '@/components/CategoryIcon';
import { useTransactions } from '@/context/TransactionContext';
import { useAppSettings } from '@/contexts/AppSettingsContext';
import { useTheme } from '@/contexts/ThemeContext';
import Coin3D from '@/components/three-d/Coin3D';
import { RootState } from '@/store';
import { Transaction, TransactionSplit } from '@/types/database';
import { FontAwesome } from '@expo/vector-icons';
import React, { useCallback, useMemo } from 'react';
import { Image, Text, TouchableOpacity, View } from 'react-native';
import { useSelector } from 'react-redux';

interface TransactionRow {
  key: string;
  transaction: Transaction;
  split: TransactionSplit | null;
  category: string;
  description: string;
  amount: number;
  tags?: string[];
}

// A transaction with category splits is one ledger movement that was divided
// across several categories — each split gets its own row here so it reads
// (and taps through to the same detail screen) like any other transaction.
function buildRows(transactions: Transaction[]): TransactionRow[] {
  const rows: TransactionRow[] = [];
  transactions.forEach((transaction) => {
    if (transaction.splits && transaction.splits.length > 0) {
      transaction.splits.forEach((split) => {
        rows.push({
          key: `${transaction.id}:${split.id}`,
          transaction,
          split,
          category: split.category,
          description: split.description || transaction.description,
          amount: split.amount,
          tags: split.tags?.length ? split.tags : transaction.tags,
        });
      });
    } else {
      rows.push({
        key: transaction.id,
        transaction,
        split: null,
        category: transaction.category,
        description: transaction.description,
        amount: transaction.amount,
        tags: transaction.tags,
      });
    }
  });
  return rows;
}

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
  const { isAurora } = useTheme();
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

  const rows = useMemo(() => buildRows(transactions), [transactions]);

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
          {isAurora ? <Coin3D size={56} /> : <FontAwesome name="inbox" size={48} color="#cbd5e1" />}
          <Text className="text-slate-500 mt-4 text-sm dark:text-slate-400">No transactions yet</Text>
          <Text className="text-slate-500 text-xs mt-1 dark:text-slate-400">Add your first transaction to get started</Text>
        </View>
      ) : (
        rows.map((row) => {
          const { transaction: item } = row;
          const isIncome = item.type === 'INCOME';
          const category = categoryMap.get(row.category);
          const account = accountMap.get(item.account_id);

          return (
            <TouchableOpacity
              key={row.key}
              onPress={() => onTransactionPress && onTransactionPress(item)}
              activeOpacity={0.7}
              className="flex-row items-center bg-white dark:bg-slate-800 px-3.5 py-2.5 rounded-2xl mb-2 shadow-sm border border-slate-100 dark:border-slate-700"
              style={{ elevation: 1 }}
            >
              <View className="relative">
                <View
                  className="w-10 h-10 rounded-xl justify-center items-center mr-3"
                  style={{ backgroundColor: category?.color ? category.color + '20' : (isIncome ? '#dcfce7' : '#fee2e2') }}
                >
                  <CategoryIcon
                    icon={category?.icon ?? 'question'}
                    size={16}
                    color={category?.color || (isIncome ? '#16a34a' : '#ef4444')}
                  />
                </View>
                {account?.logo && (
                  <View className="absolute -bottom-1.5 -left-1.5 w-6 h-6 bg-slate-100 dark:bg-slate-700 rounded-full justify-center items-center shadow-sm border border-white dark:border-slate-800 z-10 overflow-hidden">
                    <FontAwesome name="bank" size={9} color="#94a3b8" style={{ position: 'absolute' }} />
                    <Image
                      source={logoSourceMap.get(account.logo) as any}
                      className="w-full h-full"
                      resizeMode="cover"
                    />
                  </View>
                )}
              </View>
              <View className="flex-1 mr-2">
                <Text className="text-slate-900 dark:text-white font-bold text-sm" numberOfLines={1}>{row.description}</Text>
                <View className="flex-row items-center mt-0.5">
                  <Text className="text-slate-500 text-[11px] dark:text-slate-400" numberOfLines={1}>{formatDate(item.date)}</Text>
                  {row.split && (
                    <View className="ml-1.5 px-1.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/20">
                      <Text className="text-[10px] font-bold text-indigo-600 dark:text-indigo-300">Split</Text>
                    </View>
                  )}
                </View>
              </View>
              <View className="items-end">
                <Text className={`font-bold text-sm ${isIncome ? 'text-green-600' : 'text-red-500'}`} numberOfLines={1}>
                  {isIncome ? '+' : '-'}{formatCurrency(row.amount)}
                </Text>
                <Text className="text-slate-500 text-[11px] mt-0.5 dark:text-slate-400" numberOfLines={1}>{row.category}</Text>
              </View>
            </TouchableOpacity>
          );
        })
      )}
    </View>
  );
}

export default React.memo(RecentTransactions);
