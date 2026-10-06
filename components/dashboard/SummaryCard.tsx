import { useAppSettings } from '@/contexts/AppSettingsContext';
import { useI18n } from '@/contexts/I18nContext';
import { FontAwesome } from '@expo/vector-icons';
import React, { memo } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

interface SummaryCardProps {
  balance: number;
  income: number;
  expense: number;
  percentageChange?: number;
  /** True until the ledger has loaded, so zeroes are not shown as real totals. */
  loading?: boolean;
}

function SummaryCard({ balance, income, expense, percentageChange = 0, loading = false }: SummaryCardProps) {
  const isPositive = percentageChange >= 0;
  const { formatCurrency, fontSize, balancesHidden, setBalancesHidden } = useAppSettings();
  const { t } = useI18n();
  const isVerySmall = fontSize === 'V.Small';
  const titleSize = fontSize === 'V.Small' ? 'text-2xl' : fontSize === 'Small' ? 'text-3xl' : fontSize === 'Large' ? 'text-5xl' : 'text-4xl';
  const valueSize = fontSize === 'V.Small' ? 'text-base' : fontSize === 'Small' ? 'text-lg' : fontSize === 'Large' ? 'text-2xl' : 'text-xl';

  return (
    <View className={`bg-white dark:bg-slate-800 rounded-3xl ${isVerySmall ? 'p-4' : 'p-6'} shadow-2xl`} style={{ elevation: 8, marginHorizontal: -6 }}>
      <View className="items-center mb-6">
        <Text className={`text-slate-500 dark:text-slate-400 ${isVerySmall ? 'text-xs' : 'text-sm'} font-medium mb-2`}>Total Balance</Text>
        <View className="flex-row items-center justify-center">
          <Text
            className={`text-slate-900 dark:text-white ${titleSize} font-bold text-center`}
            accessibilityLabel={loading ? 'Loading total balance' : undefined}
          >
            {loading ? '—' : balancesHidden ? '••••••' : formatCurrency(balance)}
          </Text>
          <TouchableOpacity
            onPress={() => setBalancesHidden(!balancesHidden)}
            accessibilityRole="button"
            accessibilityLabel={balancesHidden ? 'Show balances' : 'Hide balances'}
            className={`${isVerySmall ? 'w-8 h-8' : 'w-9 h-9'} rounded-full bg-slate-100 dark:bg-slate-700 justify-center items-center ml-3`}
          >
            <FontAwesome name={balancesHidden ? 'eye-slash' : 'eye'} size={isVerySmall ? 13 : 15} color="#64748b" />
          </TouchableOpacity>
        </View>
        {!balancesHidden && !loading && (
          <View className={`flex-row items-center mt-2 ${isVerySmall ? 'px-2 py-1' : 'px-3 py-1.5'} rounded-full ${isPositive ? 'bg-green-50 dark:bg-green-900/30' : 'bg-red-50 dark:bg-red-900/30'}`}>
            <FontAwesome name={isPositive ? "arrow-up" : "arrow-down"} size={isVerySmall ? 9 : 10} color={isPositive ? "#10b981" : "#ef4444"} />
            <Text className={`${isVerySmall ? 'text-[10px]' : 'text-xs'} font-bold ml-1 ${isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {isPositive ? '+' : ''}{percentageChange.toFixed(1)}%
            </Text>
          </View>
        )}
      </View>
      
      <View className="flex-row justify-between">
        <View className="flex-1 mr-3">
          <View className="flex-row items-center mb-2">
            <View className={`${isVerySmall ? 'w-7 h-7' : 'w-8 h-8'} bg-green-100 dark:bg-green-900/30 rounded-xl justify-center items-center mr-2`}>
              <FontAwesome name="arrow-down" size={isVerySmall ? 11 : 12} color="#10b981" />
            </View>
            <View>
              <Text className={`text-slate-500 dark:text-slate-400 ${isVerySmall ? 'text-[10px]' : 'text-xs'} font-medium`}>{t('income')}</Text>
              <Text className={`text-slate-500 dark:text-slate-400 ${isVerySmall ? 'text-[10px]' : 'text-[10px]'}`}>This Month</Text>
            </View>
          </View>
          <Text className={`text-slate-900 dark:text-white ${valueSize} font-bold`}>{loading ? '—' : formatCurrency(income)}</Text>
        </View>
        <View className="w-px bg-slate-200 dark:bg-slate-700" />
        <View className="flex-1 ml-3">
          <View className="flex-row items-center mb-2">
            <View className={`${isVerySmall ? 'w-7 h-7' : 'w-8 h-8'} bg-red-100 dark:bg-red-900/30 rounded-xl justify-center items-center mr-2`}>
              <FontAwesome name="arrow-up" size={isVerySmall ? 11 : 12} color="#ef4444" />
            </View>
            <View>
              <Text className={`text-slate-500 dark:text-slate-400 ${isVerySmall ? 'text-[10px]' : 'text-xs'} font-medium`}>{t('expense')}</Text>
              <Text className={`text-slate-500 dark:text-slate-400 ${isVerySmall ? 'text-[10px]' : 'text-[10px]'}`}>This Month</Text>
            </View>
          </View>
          <Text className={`text-slate-900 dark:text-white ${valueSize} font-bold`}>{loading ? '—' : formatCurrency(expense)}</Text>
        </View>
      </View>
    </View>
  );
}

export default memo(SummaryCard);
