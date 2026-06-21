import CategoryIcon from '@/components/CategoryIcon';
import { useTransactions } from '@/context/TransactionContext';
import { useAppSettings } from '@/contexts/AppSettingsContext';
import { AppDispatch, RootState } from '@/store';
import { deleteTransaction } from '@/store/slices/transactionsSlice';
import { FontAwesome } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';

export default function TransactionDetail() {
  const Router = require('expo-router');
  const useParamsHook = (Router as any).useLocalSearchParams ?? (Router as any).useSearchParams ?? (() => ({}));
  const { id } = useParamsHook() as { id?: string };
  const router = (Router as any).useRouter ? (Router as any).useRouter() : (Router as any).useNavigation?.() ?? ({} as any);

  const dispatch = useDispatch<AppDispatch>();
  const { items: transactions } = useSelector((state: RootState) => state.transactions);
  const { items: accounts } = useSelector((state: RootState) => state.accounts);
  const { categories } = useTransactions();
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

  const category = categories.find(c => c.name === transaction.category);
  const isIncome = transaction.type === 'INCOME';
  const isTransfer = transaction.type === 'TRANSFER';
  const account = accounts.find(a => a.id === transaction.account_id);
  const toAccount = transaction.to_account_id ? accounts.find(a => a.id === transaction.to_account_id) : null;

  const handleDelete = () => {
    Alert.alert(
      'Delete Transaction',
      'This will permanently delete this transaction and update the account balance. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const result = await dispatch(deleteTransaction(transaction.id));
            if (deleteTransaction.rejected.match(result)) {
              Alert.alert('Error', 'Failed to delete transaction.');
              return;
            }
            router.back();
          },
        },
      ]
    );
  };

  const amountColor = isIncome ? 'text-green-600' : isTransfer ? 'text-blue-500' : 'text-red-500';
  const amountPrefix = isIncome ? '+' : isTransfer ? '' : '-';

  return (
    <View className="flex-1 bg-slate-50 dark:bg-background-dark">
      <StatusBar style="auto" />

      {/* Header */}
      <View className="px-6 pt-6 pb-4 flex-row justify-between items-center">
        <TouchableOpacity
          onPress={() => router.back()}
          className="w-10 h-10 bg-white dark:bg-slate-800 rounded-xl justify-center items-center shadow-sm border border-slate-100 dark:border-slate-700"
          style={{ elevation: 2 }}
        >
          <FontAwesome name="arrow-left" size={16} color="#000" />
        </TouchableOpacity>
        <Text className="font-bold text-lg dark:text-white">Transaction Details</Text>
        <View className="flex-row gap-2">
          <TouchableOpacity
            onPress={() => router.push({ pathname: '/modal', params: { edit: transaction.id } })}
            className="w-10 h-10 bg-blue-50 dark:bg-blue-900/30 rounded-xl justify-center items-center"
          >
            <FontAwesome name="pencil" size={18} color="#3b82f6" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleDelete}
            className="w-10 h-10 bg-red-50 dark:bg-red-900/30 rounded-xl justify-center items-center ml-2"
          >
            <FontAwesome name="trash" size={18} color="#ef4444" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView className="px-6" showsVerticalScrollIndicator={false}>
        {/* Transaction Card */}
        <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-slate-100 dark:border-slate-700" style={{ elevation: 4 }}>
          <View className="flex-row items-center justify-between mb-6">
            <View className="flex-row items-center flex-1">
              <View
                className="w-16 h-16 rounded-2xl justify-center items-center mr-4"
                style={{ backgroundColor: category?.color ? category.color + '20' : (isIncome ? '#dcfce7' : isTransfer ? '#dbeafe' : '#fee2e2') }}
              >
                <CategoryIcon
                  icon={isTransfer ? 'exchange' : (category?.icon ?? 'question')}
                  size={24}
                  color={category?.color || (isIncome ? '#16a34a' : isTransfer ? '#3b82f6' : '#ef4444')}
                />
              </View>
              <View className="flex-1">
                <Text className="text-slate-900 dark:text-white font-bold text-xl mb-1">{transaction.description}</Text>
                <Text className="text-slate-500 text-sm">{transaction.category}</Text>
              </View>
            </View>
            <View className="items-end">
              <Text className={`font-bold text-2xl ${amountColor}`}>
                {amountPrefix}{formatCurrency(transaction.amount)}
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

            <View className="flex-row justify-between items-center">
              <Text className="text-slate-500 text-sm">Account</Text>
              <Text className="text-slate-900 dark:text-white font-medium">{account?.name || transaction.account_id}</Text>
            </View>

            {isTransfer && toAccount && (
              <View className="flex-row justify-between items-center">
                <Text className="text-slate-500 text-sm">To Account</Text>
                <Text className="text-slate-900 dark:text-white font-medium">{toAccount.name}</Text>
              </View>
            )}

            <View className="flex-row justify-between">
              <Text className="text-slate-500 text-sm">Date</Text>
              <Text className="text-slate-900 dark:text-white font-medium">
                {new Date(transaction.date).toLocaleDateString('en-US', {
                  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
                })}
              </Text>
            </View>

            <View className="flex-row justify-between">
              <Text className="text-slate-500 text-sm">Time</Text>
              <Text className="text-slate-900 dark:text-white font-medium">
                {new Date(transaction.date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>

            {(transaction.fees ?? 0) > 0 && (
              <View className="flex-row justify-between">
                <Text className="text-slate-500 text-sm">Fees</Text>
                <Text className="text-slate-900 dark:text-white font-medium">{formatCurrency(transaction.fees!)}</Text>
              </View>
            )}

            {(transaction.tax ?? 0) > 0 && (
              <View className="flex-row justify-between">
                <Text className="text-slate-500 text-sm">Tax</Text>
                <Text className="text-slate-900 dark:text-white font-medium">{formatCurrency(transaction.tax!)}</Text>
              </View>
            )}

            {transaction.sender_receiver ? (
              <View className="flex-row justify-between">
                <Text className="text-slate-500 text-sm">Sender / Receiver</Text>
                <Text className="text-slate-900 dark:text-white font-medium">{transaction.sender_receiver}</Text>
              </View>
            ) : null}

            {transaction.reference_number ? (
              <View className="flex-row justify-between">
                <Text className="text-slate-500 text-sm">Reference</Text>
                <Text className="text-slate-900 dark:text-white font-medium">{transaction.reference_number}</Text>
              </View>
            ) : null}

            <View className="flex-row items-start justify-between">
              <Text className="text-slate-500 text-sm mt-1">Tags</Text>
              <View className="flex-1 items-end">
                {transaction.tags && transaction.tags.length > 0 ? (
                  <View className="flex-row flex-wrap justify-end">
                    {transaction.tags.map((tag) => (
                      <TouchableOpacity
                        key={tag}
                        onPress={() => router.push({ pathname: '/(tabs)/transactions', params: { tag } })}
                        className="px-2.5 py-1 rounded-full bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 ml-2 mb-2"
                      >
                        <Text className="text-indigo-700 dark:text-indigo-300 text-xs font-semibold">#{tag}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : (
                  <Text className="text-slate-400 text-sm">No tags</Text>
                )}
              </View>
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
