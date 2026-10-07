import CategoryIcon from '@/components/CategoryIcon';
import { useTransactions } from '@/context/TransactionContext';
import { useAppSettings } from '@/contexts/AppSettingsContext';
import { useTheme } from '@/contexts/ThemeContext';
import { themeTokens } from '@/constants/theme';
import { AppDispatch, RootState } from '@/store';
import { deleteTransaction } from '@/store/slices/transactionsSlice';
import { FontAwesome } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { Linking, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Alert } from '@/utils/alert';
import { useDispatch, useSelector } from 'react-redux';

export default function TransactionDetail() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();

  const dispatch = useDispatch<AppDispatch>();
  const { items: transactions } = useSelector((state: RootState) => state.transactions);
  const { items: accounts } = useSelector((state: RootState) => state.accounts);
  const { categories } = useTransactions();
  const { formatCurrency } = useAppSettings();
  // Icon colours are props, not classes, so they need the token palette to
  // follow the theme; #64748b was only 3.07:1 on the dark cards.
  const { actualTheme } = useTheme();
  const theme = themeTokens(actualTheme === 'dark');

  const transaction = transactions.find(t => t.id === id);

  if (!transaction) {
    return (
      <View className="flex-1 bg-slate-50 dark:bg-background-dark">
        <StatusBar style="auto" />
        <View className="px-6 pt-6 pb-4 flex-row items-center">
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Go back"
            onPress={() => router.back()}
            className="w-10 h-10 bg-white dark:bg-slate-800 rounded-xl justify-center items-center shadow-sm border border-slate-100 dark:border-slate-700"
            style={{ elevation: 2 }}
          >
            <FontAwesome name="arrow-left" size={16} color={theme.textMuted} />
          </TouchableOpacity>
          <Text className="text-slate-900 dark:text-white font-bold text-lg ml-4">Transaction Details</Text>
        </View>
        <View className="flex-1 items-center justify-center px-6">
          <FontAwesome name="exclamation-circle" size={48} color={theme.border} />
          <Text className="text-slate-500 dark:text-slate-400 text-base mt-4">Transaction not found</Text>
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
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Go back"
          onPress={() => router.back()}
          className="w-10 h-10 bg-white dark:bg-slate-800 rounded-xl justify-center items-center shadow-sm border border-slate-100 dark:border-slate-700"
          style={{ elevation: 2 }}
        >
          <FontAwesome name="arrow-left" size={16} color={theme.textMuted} />
        </TouchableOpacity>
        <Text className="text-slate-900 dark:text-white font-bold text-lg">Transaction Details</Text>
        <View className="flex-row gap-2">
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Edit"
            onPress={() => router.push({ pathname: '/modal', params: { edit: transaction.id } })}
            className="w-10 h-10 bg-blue-50 dark:bg-blue-900/30 rounded-xl justify-center items-center"
          >
            <FontAwesome name="pencil" size={18} color="#3b82f6" />
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Delete"
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
                style={{
                  backgroundColor: category?.color
                    ? category.color + (actualTheme === 'dark' ? '33' : '20')
                    : actualTheme === 'dark'
                      ? (isIncome ? '#064e3b' : isTransfer ? '#1e3a8a' : '#7f1d1d')
                      : (isIncome ? '#dcfce7' : isTransfer ? '#dbeafe' : '#fee2e2'),
                }}
              >
                <CategoryIcon
                  icon={isTransfer ? 'exchange' : (category?.icon ?? 'question')}
                  size={24}
                  color={category?.color || (actualTheme === 'dark'
                    ? (isIncome ? '#34d399' : isTransfer ? '#60a5fa' : '#f87171')
                    : (isIncome ? '#16a34a' : isTransfer ? '#3b82f6' : '#ef4444'))}
                />
              </View>
              <View className="flex-1">
                {/* SMS-derived descriptions run long; cap it rather than
                    letting it push the amount off the card. */}
                <Text numberOfLines={2} className="text-slate-900 dark:text-white font-bold text-xl mb-1">
                  {transaction.description}
                </Text>
                <Text numberOfLines={1} className="text-slate-500 dark:text-slate-400 text-sm">
                  {transaction.category}
                </Text>
              </View>
            </View>
            {/* Shrinkable so a large amount wraps inside the card instead of
                overflowing it; `flex-shrink` alone is not enough on RN. */}
            <View className="items-end ml-3 shrink">
              <Text
                adjustsFontSizeToFit
                numberOfLines={1}
                minimumFontScale={0.7}
                className={`font-bold text-2xl text-right ${amountColor}`}
              >
                {amountPrefix}{formatCurrency(transaction.amount)}
              </Text>
            </View>
          </View>

          {/* Details */}
          <View className="gap-4">
            <View className="flex-row justify-between items-center">
              <Text className="text-slate-500 dark:text-slate-400 text-sm">Type</Text>
              <TouchableOpacity onPress={() => router.push({ pathname: '/(tabs)/transactions', params: { type: transaction.type } })}>
                <Text className="text-blue-500 dark:text-blue-400 font-medium underline">{transaction.type}</Text>
              </TouchableOpacity>
            </View>

            {/* Falls back to the raw id, which is a 36-character UUID. */}
            <DetailRow label="Account" value={account?.name || transaction.account_id} />

            {isTransfer && toAccount && (
              <DetailRow label="To Account" value={toAccount.name} />
            )}

            <DetailRow
              label="Date"
              value={new Date(transaction.date).toLocaleDateString('en-US', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
              })}
              lines={2}
            />

            <DetailRow
              label="Time"
              value={new Date(transaction.date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
            />

            {(transaction.fees ?? 0) > 0 && (
              <DetailRow label="Fees" value={formatCurrency(transaction.fees!)} />
            )}

            {(transaction.tax ?? 0) > 0 && (
              <DetailRow label="Tax" value={formatCurrency(transaction.tax!)} />
            )}

            {transaction.sender_receiver ? (
              <DetailRow label="Sender / Receiver" value={transaction.sender_receiver} lines={2} />
            ) : null}

            {transaction.reference_number ? (
              <DetailRow label="Reference" value={transaction.reference_number} />
            ) : null}

            {transaction.receipt_url ? (
              <View className="flex-row justify-between items-center">
                <Text className="text-slate-500 dark:text-slate-400 text-sm">Receipt</Text>
                <TouchableOpacity onPress={() => Linking.openURL(transaction.receipt_url!)} className="flex-row items-center">
                  <FontAwesome name="external-link" size={12} color="#6366f1" />
                  <Text className="text-indigo-600 dark:text-indigo-400 font-medium ml-1">View Receipt</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            <View className="flex-row items-start justify-between">
              <Text className="text-slate-500 dark:text-slate-400 text-sm mt-1">Tags</Text>
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
                  <Text className="text-slate-500 text-sm dark:text-slate-400">No tags</Text>
                )}
              </View>
            </View>

            {transaction.updated_at && (
              <DetailRow label="Last Updated" value={new Date(transaction.updated_at).toLocaleString()} lines={2} />
            )}
          </View>
        </View>

        <View style={{ height: 48 }} />
      </ScrollView>
    </View>
  );
}

/**
 * A label/value row for the details list.
 *
 * Each row used to be a bare `flex-row justify-between` with two unconstrained
 * Text children, so React Native gave both their natural width and anything
 * long — an account UUID fallback, an SMS merchant name, a full weekday date —
 * ran outside the card. The label keeps its intrinsic width while the value
 * takes the remaining space and truncates.
 */
function DetailRow({ label, value, lines = 1 }: { label: string; value: string; lines?: number }) {
  return (
    <View className="flex-row justify-between items-start gap-4">
      <Text className="text-slate-500 dark:text-slate-400 text-sm shrink-0">{label}</Text>
      <Text
        numberOfLines={lines}
        ellipsizeMode="tail"
        className="text-slate-900 dark:text-white font-medium flex-1 text-right"
      >
        {value}
      </Text>
    </View>
  );
}
