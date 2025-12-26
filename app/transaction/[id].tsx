import { CATEGORIES } from '@/constants/MockData';
import { useAppSettings } from '@/contexts/AppSettingsContext';
import { RootState } from '@/store';
import { FontAwesome } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';

import { useSelector } from 'react-redux';

export default function TransactionDetail() {
  // Robust parameter handling for expo-router versions
  const Router = require('expo-router');
  const useParamsHook = (Router as any).useLocalSearchParams ?? (Router as any).useSearchParams ?? (() => ({}));
  const { id } = useParamsHook() as { id?: string };
  const router = (Router as any).useRouter ? (Router as any).useRouter() : (Router as any).useNavigation?.() ?? ({} as any);

  const { items: transactions } = useSelector((state: RootState) => state.transactions);
  const { items: accounts } = useSelector((state: RootState) => state.accounts);
  const { formatCurrency } = useAppSettings();

  const transaction = transactions.find(t => t.id === id);

  if (!transaction) {
    return (
      <View className="flex-1 bg-slate-50 dark:bg-background-dark">
        <StatusBar style="auto" />
        <View className="p-6">
          <Text className="text-slate-500">Transaction not found</Text>
        </View>
      </View>
    );
  }

  const category = CATEGORIES.find(c => c.name === transaction.category);
  const isIncome = transaction.type === 'INCOME';
  const account = accounts.find(a => a.id === transaction.account_id);

  return (
    <View className="flex-1 bg-slate-50 dark:bg-background-dark">
      <StatusBar style="auto" />

      {/* Header */}
      <View className="px-6 pt-6 pb-4 flex-row justify-between items-center">
        <TouchableOpacity onPress={() => router.back()} className="w-10 h-10 bg-white dark:bg-slate-800 rounded-xl justify-center items-center shadow-sm border border-slate-100 dark:border-slate-700" style={{ elevation: 2 }}>
          <FontAwesome name="arrow-left" size={16} color="#000" />
        </TouchableOpacity>
        <Text className="font-bold text-lg dark:text-white">Transaction Details</Text>
        <TouchableOpacity
          onPress={() => router.push({ pathname: '/modal', params: { edit: transaction.id } })}
          className="w-10 h-10 bg-blue-50 dark:bg-blue-900/30 rounded-xl justify-center items-center"
        >
          <FontAwesome name="pencil" size={18} color="#3b82f6" />
        </TouchableOpacity>
      </View>

      <ScrollView className="px-6" showsVerticalScrollIndicator={false}>
        {/* Transaction Card */}
        <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-slate-100 dark:border-slate-700" style={{ elevation: 4 }}>
          <View className="flex-row items-center justify-between mb-6">
            <View className="flex-row items-center flex-1">
              <View
                className="w-16 h-16 rounded-2xl justify-center items-center mr-4"
                style={{ backgroundColor: category?.color ? category.color + '20' : (isIncome ? '#dcfce7' : '#fee2e2') }}
              >
                <FontAwesome
                  name={category?.icon as any || 'question'}
                  size={24}
                  color={category?.color || (isIncome ? '#16a34a' : '#ef4444')}
                />
              </View>
              <View className="flex-1">
                <Text className="text-slate-900 dark:text-white font-bold text-xl mb-1">{transaction.description}</Text>
                <Text className="text-slate-500 text-sm">{transaction.category}</Text>
              </View>
            </View>
            <View className="items-end">
              <Text className={`font-bold text-2xl ${isIncome ? 'text-green-600' : 'text-red-500'}`}>
                {isIncome ? '+' : '-'}{formatCurrency(transaction.amount)}
              </Text>
            </View>
          </View>

          {/* Details */}
          <View className="space-y-4">
            <View className="flex-row justify-between items-center">
              <Text className="text-slate-500 text-sm">Type</Text>
              <TouchableOpacity onPress={() => router.push({ pathname: '/(tabs)/transactions', params: { type: transaction.type } })}>
                <Text className="text-blue-500 dark:text-blue-400 font-medium underline">{transaction.type}</Text>
              </TouchableOpacity>
            </View>
            <View className="flex-row justify-between">
              <Text className="text-slate-500 text-sm">Date</Text>
              <Text className="text-slate-900 dark:text-white font-medium">
                {new Date(transaction.date).toLocaleDateString('en-US', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })}
              </Text>
            </View>
            <View className="flex-row justify-between">
              <Text className="text-slate-500 text-sm">Time</Text>
              <Text className="text-slate-900 dark:text-white font-medium">
                {new Date(transaction.date).toLocaleTimeString('en-US', {
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </Text>
            </View>
            <View className="flex-row justify-between items-center">
              <Text className="text-slate-500 text-sm">Account</Text>
              <TouchableOpacity onPress={() => router.push(`/account/${transaction.account_id}`)}>
                <Text className="text-blue-500 dark:text-blue-400 font-medium underline">{account?.name || transaction.account_id}</Text>
              </TouchableOpacity>
            </View>
            {transaction.updated_at && (
              <View className="flex-row justify-between">
                <Text className="text-slate-500 text-sm">Last Updated</Text>
                <Text className="text-slate-900 dark:text-white font-medium">
                  {new Date(transaction.updated_at).toLocaleString()}
                </Text>
              </View>
            )}
          </View>
        </View>

        <View style={{ height: 48 }} />
      </ScrollView>
    </View>
  );
}