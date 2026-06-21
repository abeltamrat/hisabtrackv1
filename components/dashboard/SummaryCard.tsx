import { useAppSettings } from '@/contexts/AppSettingsContext';
import { useI18n } from '@/contexts/I18nContext';
import { FontAwesome } from '@expo/vector-icons';
import React from 'react';
import { Text, View } from 'react-native';

interface SummaryCardProps {
  balance: number;
  income: number;
  expense: number;
  percentageChange?: number;
}

export default function SummaryCard({ balance, income, expense, percentageChange = 0 }: SummaryCardProps) {
  const isPositive = percentageChange >= 0;
  const { formatCurrency, fontSize } = useAppSettings();
  const { t } = useI18n();
  const isVerySmall = fontSize === 'V.Small';
  const titleSize = fontSize === 'V.Small' ? 'text-2xl' : fontSize === 'Small' ? 'text-3xl' : fontSize === 'Large' ? 'text-5xl' : 'text-4xl';
  const valueSize = fontSize === 'V.Small' ? 'text-base' : fontSize === 'Small' ? 'text-lg' : fontSize === 'Large' ? 'text-2xl' : 'text-xl';

  return (
    <View className={`bg-white dark:bg-slate-800 rounded-3xl ${isVerySmall ? 'p-4' : 'p-6'} shadow-2xl`} style={{ elevation: 8, marginHorizontal: -6 }}>
      <View className="flex-row items-center justify-between mb-4">
        <Text className={`text-slate-500 dark:text-slate-400 ${isVerySmall ? 'text-xs' : 'text-sm'} font-medium`}>Total Balance</Text>
        <View className={`flex-row items-center ${isVerySmall ? 'px-2 py-1' : 'px-3 py-1.5'} rounded-full ${isPositive ? 'bg-green-50 dark:bg-green-900/30' : 'bg-red-50 dark:bg-red-900/30'}`}>
          <FontAwesome name={isPositive ? "arrow-up" : "arrow-down"} size={isVerySmall ? 9 : 10} color={isPositive ? "#10b981" : "#ef4444"} />
          <Text className={`${isVerySmall ? 'text-[10px]' : 'text-xs'} font-bold ml-1 ${isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
            {isPositive ? '+' : ''}{percentageChange.toFixed(1)}%
          </Text>
        </View>
      </View>
      <Text className={`text-slate-900 dark:text-white ${titleSize} font-bold mb-6`}>{formatCurrency(balance)}</Text>
      
      <View className="flex-row justify-between">
        <View className="flex-1 mr-3">
          <View className="flex-row items-center mb-2">
            <View className={`${isVerySmall ? 'w-7 h-7' : 'w-8 h-8'} bg-green-100 dark:bg-green-900/30 rounded-xl justify-center items-center mr-2`}>
              <FontAwesome name="arrow-down" size={isVerySmall ? 11 : 12} color="#10b981" />
            </View>
            <Text className={`text-slate-500 dark:text-slate-400 ${isVerySmall ? 'text-[10px]' : 'text-xs'} font-medium`}>{t('income')}</Text>
          </View>
          <Text className={`text-slate-900 dark:text-white ${valueSize} font-bold`}>{formatCurrency(income)}</Text>
        </View>
        <View className="w-px bg-slate-200 dark:bg-slate-700" />
        <View className="flex-1 ml-3">
          <View className="flex-row items-center mb-2">
            <View className={`${isVerySmall ? 'w-7 h-7' : 'w-8 h-8'} bg-red-100 dark:bg-red-900/30 rounded-xl justify-center items-center mr-2`}>
              <FontAwesome name="arrow-up" size={isVerySmall ? 11 : 12} color="#ef4444" />
            </View>
            <Text className={`text-slate-500 dark:text-slate-400 ${isVerySmall ? 'text-[10px]' : 'text-xs'} font-medium`}>{t('expense')}</Text>
          </View>
          <Text className={`text-slate-900 dark:text-white ${valueSize} font-bold`}>{formatCurrency(expense)}</Text>
        </View>
      </View>
    </View>
  );
}
