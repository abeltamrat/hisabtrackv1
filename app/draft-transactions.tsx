import { useAppSettings } from '@/contexts/AppSettingsContext';
import { DraftTransaction, DraftTransactionService } from '@/services/DraftTransactionService';
import { RootState } from '@/store';
import { addTransaction } from '@/store/slices/transactionsSlice';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { Alert, Platform, RefreshControl, ScrollView, Text, TouchableOpacity, View } from 'react-native';

import { useDispatch, useSelector } from 'react-redux';

export default function DraftTransactionsScreen() {
  const router = useRouter();
  const dispatch = useDispatch();
  const params = useLocalSearchParams();
  const accountId = params.accountId as string;

  const { formatCurrency } = useAppSettings();
  const { items: accounts } = useSelector((state: RootState) => state.accounts);
  const account = accounts.find(a => a.id === accountId);

  const [drafts, setDrafts] = useState<DraftTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unrecorded' | 'recorded'>('unrecorded');

  useEffect(() => {
    loadDrafts();
  }, [accountId, filter]);

  const loadDrafts = async () => {
    try {
      setLoading(true);
      let allDrafts: DraftTransaction[];

      if (filter === 'unrecorded') {
        allDrafts = await DraftTransactionService.getUnrecordedByAccount(accountId);
      } else if (filter === 'recorded') {
        const all = await DraftTransactionService.getByAccount(accountId);
        allDrafts = all.filter(d => d.is_recorded);
      } else {
        allDrafts = await DraftTransactionService.getByAccount(accountId);
      }

      // Sort by date descending
      allDrafts.sort((a, b) => b.date - a.date);
      setDrafts(allDrafts);
    } catch (error) {
      console.error('Error loading drafts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadDrafts();
    setRefreshing(false);
  };

  const handleRecordTransaction = async (draft: DraftTransaction) => {
    try {
      // Create transaction
      // @ts-ignore
      const result = await dispatch(addTransaction({
        account_id: draft.account_id,
        type: draft.type,
        amount: draft.amount,
        category: draft.category,
        description: draft.description,
        date: draft.date,
        sender_receiver: draft.sender_receiver,
        reference_number: draft.reference_number,
        sms_id: draft.sms_id,
      }));

      // Mark draft as recorded
      if (result.payload && (result.payload as any).id) {
        await DraftTransactionService.markAsRecorded(draft.id, (result.payload as any).id);
        await loadDrafts();

        if (Platform.OS === 'web') {
          alert('Transaction recorded successfully!');
        } else {
          Alert.alert('Success', 'Transaction recorded successfully!');
        }
      }
    } catch (error) {
      console.error('Error recording transaction:', error);
      if (Platform.OS === 'web') {
        alert('Failed to record transaction');
      } else {
        Alert.alert('Error', 'Failed to record transaction');
      }
    }
  };

  const handleDeleteDraft = async (draftId: string) => {
    const confirmDelete = () => {
      DraftTransactionService.delete(draftId).then(() => {
        loadDrafts();
      });
    };

    if (Platform.OS === 'web') {
      if (confirm('Are you sure you want to delete this draft?')) {
        confirmDelete();
      }
    } else {
      Alert.alert(
        'Delete Draft',
        'Are you sure you want to delete this draft transaction?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: confirmDelete },
        ]
      );
    }
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    } else if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
  };

  const unrecordedCount = drafts.filter(d => !d.is_recorded).length;

  return (
    <View className="flex-1 bg-slate-50 dark:bg-background-dark">
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style="auto" />

      {/* Header */}
      <LinearGradient
        colors={['#6366f1', '#4f46e5']}
        className="px-6 pt-6 pb-8 rounded-b-[32px]"
        style={{ elevation: 4 }}
      >
        <View className="flex-row justify-between items-center mb-4">
          <TouchableOpacity onPress={() => router.back()} className="w-10 h-10 bg-white/20 rounded-xl justify-center items-center">
            <FontAwesome name="arrow-left" size={18} color="#fff" />
          </TouchableOpacity>
          <Text className="text-white text-xl font-bold">SMS Transactions</Text>
          <TouchableOpacity onPress={handleRefresh} className="w-10 h-10 bg-white/20 rounded-xl justify-center items-center">
            <FontAwesome name="refresh" size={18} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Account Info */}
        <View className="bg-white/10 backdrop-blur-lg rounded-2xl p-4">
          <Text className="text-white/80 text-sm mb-1">{account?.name}</Text>
          <Text className="text-white text-2xl font-bold">{formatCurrency(account?.balance || 0)}</Text>
          {unrecordedCount > 0 && (
            <View className="mt-2 flex-row items-center">
              <FontAwesome name="exclamation-circle" size={14} color="#fbbf24" />
              <Text className="text-yellow-300 text-sm ml-2 font-semibold">
                {unrecordedCount} unrecorded transaction{unrecordedCount !== 1 ? 's' : ''}
              </Text>
            </View>
          )}
        </View>
      </LinearGradient>

      {/* Filter Tabs */}
      <View className="px-6 py-4">
        <View className="flex-row bg-white dark:bg-slate-800 p-1.5 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700">
          {(['unrecorded', 'all', 'recorded'] as const).map((f) => (
            <TouchableOpacity
              key={f}
              onPress={() => setFilter(f)}
              className={`flex-1 py-3 rounded-xl items-center ${filter === f ? 'bg-primary-500' : ''
                }`}
            >
              <Text className={`text-sm font-bold capitalize ${filter === f ? 'text-white' : 'text-slate-500 dark:text-slate-400'
                }`}>
                {f}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Drafts List */}
      <ScrollView
        className="flex-1 px-6"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      >
        {loading ? (
          <View className="items-center justify-center mt-20">
            <Text className="text-slate-500 dark:text-slate-400">Loading...</Text>
          </View>
        ) : drafts.length === 0 ? (
          <View className="items-center justify-center mt-20">
            <View className="w-20 h-20 bg-slate-100 dark:bg-slate-800 rounded-full justify-center items-center mb-4">
              <FontAwesome name="inbox" size={32} color="#cbd5e1" />
            </View>
            <Text className="text-slate-900 dark:text-white font-bold text-lg mb-2">No Transactions</Text>
            <Text className="text-slate-400 text-sm text-center">
              {filter === 'unrecorded'
                ? 'All SMS transactions have been recorded'
                : 'No SMS transactions found'}
            </Text>
          </View>
        ) : (
          drafts.map((draft) => {
            const isIncome = draft.type === 'INCOME';
            const isRecorded = draft.is_recorded;

            return (
              <View
                key={draft.id}
                className={`bg-white dark:bg-slate-800 rounded-2xl p-4 mb-3 shadow-sm border ${isRecorded
                  ? 'border-green-200 dark:border-green-900'
                  : 'border-yellow-200 dark:border-yellow-900'
                  }`}
                style={{ elevation: 2 }}
              >
                {/* Status Badge */}
                <View className="flex-row justify-between items-start mb-3">
                  <View className={`px-3 py-1 rounded-full ${isRecorded ? 'bg-green-100 dark:bg-green-900/30' : 'bg-yellow-100 dark:bg-yellow-900/30'
                    }`}>
                    <Text className={`text-xs font-bold ${isRecorded ? 'text-green-700 dark:text-green-400' : 'text-yellow-700 dark:text-yellow-400'
                      }`}>
                      {isRecorded ? '✓ Recorded' : '⚠ Unrecorded'}
                    </Text>
                  </View>
                  <Text className="text-slate-400 text-xs">{formatDate(draft.date)}</Text>
                </View>

                {/* Transaction Details */}
                <View className="flex-row items-center mb-3">
                  <View
                    className={`w-12 h-12 rounded-xl justify-center items-center mr-3 ${isIncome ? 'bg-green-100 dark:bg-green-900/30' : 'bg-red-100 dark:bg-red-900/30'
                      }`}
                  >
                    <FontAwesome
                      name={isIncome ? 'arrow-down' : 'arrow-up'}
                      size={18}
                      color={isIncome ? '#10b981' : '#ef4444'}
                    />
                  </View>
                  <View className="flex-1">
                    <Text className="text-slate-900 dark:text-white font-bold text-base mb-1">
                      {draft.description}
                    </Text>
                    <View className="flex-row items-center">
                      <Text className="text-slate-400 text-xs">{draft.category}</Text>
                      <View className="w-1 h-1 bg-slate-300 rounded-full mx-2" />
                      <Text className="text-slate-400 text-xs">{formatTime(draft.date)}</Text>
                    </View>
                  </View>
                  <Text className={`font-bold text-lg ${isIncome ? 'text-green-600' : 'text-red-500'
                    }`}>
                    {isIncome ? '+' : '-'}{formatCurrency(draft.amount)}
                  </Text>
                </View>

                {/* Additional Info */}
                {(draft.fees || draft.tax || draft.reference_number) && (
                  <View className="bg-slate-50 dark:bg-slate-900 rounded-xl p-3 mb-3">
                    {draft.fees && (
                      <View className="flex-row justify-between mb-1">
                        <Text className="text-slate-500 text-xs">Fee</Text>
                        <Text className="text-slate-700 dark:text-slate-300 text-xs font-semibold">
                          {formatCurrency(draft.fees)}
                        </Text>
                      </View>
                    )}
                    {draft.tax && (
                      <View className="flex-row justify-between mb-1">
                        <Text className="text-slate-500 text-xs">Tax</Text>
                        <Text className="text-slate-700 dark:text-slate-300 text-xs font-semibold">
                          {formatCurrency(draft.tax)}
                        </Text>
                      </View>
                    )}
                    {draft.reference_number && (
                      <View className="flex-row justify-between">
                        <Text className="text-slate-500 text-xs">Ref</Text>
                        <Text className="text-slate-700 dark:text-slate-300 text-xs font-mono">
                          {draft.reference_number}
                        </Text>
                      </View>
                    )}
                  </View>
                )}

                {/* Actions */}
                {!isRecorded && (
                  <View className="flex-row gap-2">
                    <TouchableOpacity
                      onPress={() => handleRecordTransaction(draft)}
                      className="flex-1 bg-primary-500 py-3 rounded-xl items-center"
                    >
                      <Text className="text-white font-bold">Record Transaction</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleDeleteDraft(draft.id)}
                      className="bg-red-50 dark:bg-red-900/30 px-4 py-3 rounded-xl items-center"
                    >
                      <FontAwesome name="trash" size={16} color="#ef4444" />
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          })
        )}
        <View className="h-8" />
      </ScrollView>
    </View>
  );
}
