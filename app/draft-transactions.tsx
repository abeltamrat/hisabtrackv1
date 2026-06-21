import { useAppSettings } from '@/contexts/AppSettingsContext';
import { useTransactions } from '@/context/TransactionContext';
import CategoryIcon from '@/components/CategoryIcon';
import { BackgroundService } from '@/services/BackgroundService';
import { DraftTransaction, DraftTransactionService } from '@/services/DraftTransactionService';
import { SMSLearningService } from '@/services/SMSLearningService';
import { AppDispatch, RootState } from '@/store';
import { fetchAccounts } from '@/store/slices/accountsSlice';
import { addTransaction } from '@/store/slices/transactionsSlice';
import { FontAwesome } from '@expo/vector-icons';
import { SMSSyncService } from '@/services/SMSSyncService';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { Alert, Modal, Platform, RefreshControl, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { useDispatch, useSelector } from 'react-redux';

export default function DraftTransactionsScreen() {
  const router = useRouter();
  const dispatch = useDispatch<AppDispatch>();
  const params = useLocalSearchParams();
  const accountId = typeof params.accountId === 'string' ? params.accountId : undefined;

  const { formatCurrency } = useAppSettings();
  const { categories } = useTransactions();
  const { items: accounts } = useSelector((state: RootState) => state.accounts);
  const { items: transactions } = useSelector((state: RootState) => state.transactions);
  const account = accountId ? accounts.find(a => a.id === accountId) : undefined;

  const [drafts, setDrafts] = useState<DraftTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unrecorded' | 'recorded'>('unrecorded');

  // Preview & Confirm Modal States
  const [selectedDraft, setSelectedDraft] = useState<DraftTransaction | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Edit states for confirmation
  const [editedDescription, setEditedDescription] = useState('');
  const [editedCategory, setEditedCategory] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [syncStatus, setSyncStatus] = useState({ status: 'Idle', progress: 0 });

  // Filter & Grouping States
  const [typeFilter, setTypeFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [groupingMode, setGroupingMode] = useState<'none' | 'date' | 'month' | 'year' | 'type'>('date');
  const [showOptions, setShowOptions] = useState(false);

  const filteredDrafts = drafts.filter(d => {
    if (typeFilter === 'income') return d.type === 'INCOME';
    if (typeFilter === 'expense') return d.type === 'EXPENSE';
    return true;
  });

  const getGroupedDrafts = () => {
    if (groupingMode === 'none') return [{ title: '', data: filteredDrafts }];

    const groups: Record<string, DraftTransaction[]> = {};

    filteredDrafts.forEach(d => {
      let key = '';
      const date = new Date(d.date);

      if (groupingMode === 'date') key = formatDate(d.date);
      else if (groupingMode === 'month') key = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      else if (groupingMode === 'year') key = date.getFullYear().toString();
      else if (groupingMode === 'type') key = d.type;

      if (!groups[key]) groups[key] = [];
      groups[key].push(d);
    });

    return Object.keys(groups).map(key => ({
      title: key,
      data: groups[key]
    }));
  };

  useEffect(() => {
    SMSSyncService.setSyncStatusListener((status) => {
      if (!accountId || status.accountId === accountId) {
        setSyncStatus({ status: status.status, progress: status.progress });
      }
    });
  }, [accountId]);

  useEffect(() => {
    void loadDrafts();
    if (accountId) {
      void checkInitialSync();
    }
    void BackgroundService.markReconciliationReview();
  }, [accountId, filter]);

  const checkInitialSync = async () => {
    if (!account) return;
    const lastSync = await SMSSyncService.getLastSuccessfulSync(account.id);
    if (!lastSync) {
      Alert.alert(
        'Historical Sync',
        'This is the first time you are syncing this account. Would you like to scan for transactions from the last 90 days?',
        [
          { text: 'Later', style: 'cancel' },
          {
            text: 'Sync History',
            onPress: () => handleSync(true)
          }
        ]
      );
    }
  };

  const handleSync = async (historical: boolean = false) => {
    setRefreshing(true);
    try {
      if (account) {
        await SMSSyncService.syncAccountSMS(account, transactions, {
          historicalDays: historical ? 90 : undefined
        });
      } else {
        await SMSSyncService.checkAllNow(accounts, transactions);
      }
      await BackgroundService.markReconciliationReview();
      await loadDrafts();
    } catch (e) {
      console.error('Sync failed:', e);
      Alert.alert('Sync Failed', 'Could not sync SMS transactions. Please try again.');
    } finally {
      setRefreshing(false);
    }
  };

  const handleReject = async (draftId: string) => {
    Alert.alert(
      'Reject Draft',
      'Are you sure you want to reject this transaction? It will be moved to the rejected list.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: async () => {
            try {
              await DraftTransactionService.updateStatus(draftId, 'REJECTED');
              await loadDrafts();
            } catch (e) {
              Alert.alert('Error', 'Failed to reject draft.');
            }
          }
        }
      ]
    );
  };

  const loadDrafts = async () => {
    try {
      setLoading(true);
      let allDrafts: DraftTransaction[];

      if (filter === 'unrecorded') {
        allDrafts = accountId
          ? await DraftTransactionService.getByStatus(accountId, 'PENDING')
          : (await DraftTransactionService.getAll()).filter((draft) => draft.status === 'PENDING');
      } else if (filter === 'recorded') {
        allDrafts = accountId
          ? await DraftTransactionService.getByStatus(accountId, 'RECORDED')
          : (await DraftTransactionService.getAll()).filter((draft) => draft.status === 'RECORDED');
      } else {
        allDrafts = accountId
          ? await DraftTransactionService.getByAccount(accountId)
          : await DraftTransactionService.getAll();
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

  const handleRefresh = () => handleSync(false);

  const openConfirmModal = (draft: DraftTransaction) => {
    setSelectedDraft(draft);
    setEditedDescription(draft.description);
    setEditedCategory(draft.category);
    setShowConfirmModal(true);
  };

  const handleRecordConfirmed = async () => {
    if (!selectedDraft) return;

    setIsRecording(true);
    try {
      // 1. Learn from corrections
      const hasCorrections =
        editedDescription !== selectedDraft.description ||
        editedCategory !== selectedDraft.category;
      const learnedSender = selectedDraft.sms_sender || account?.sms_number?.split(',')[0] || '';

      if (hasCorrections && learnedSender && (selectedDraft.sender_receiver || selectedDraft.reference_number)) {
        await SMSLearningService.learn({
          accountId: selectedDraft.account_id,
          sender: learnedSender,
          rawMerchant: selectedDraft.sender_receiver,
          referenceNumber: selectedDraft.reference_number,
          correctedDescription: editedDescription,
          correctedCategory: editedCategory,
        });
      }

      // 2. Create transaction
      const result = await dispatch(addTransaction({
        account_id: selectedDraft.account_id,
        type: selectedDraft.type,
        amount: selectedDraft.amount,
        category: editedCategory,
        description: editedDescription,
        date: selectedDraft.date,
        sender_receiver: selectedDraft.sender_receiver,
        reference_number: selectedDraft.reference_number,
        sms_id: selectedDraft.sms_id,
        fees: selectedDraft.fees,
        tax: selectedDraft.tax,
      }));

      if (addTransaction.rejected.match(result)) {
        Alert.alert('Error', 'Failed to record transaction. Please try again.');
        return;
      }

      await dispatch(fetchAccounts());

      const transactionId = (result.payload as any)?.id;
      if (transactionId) {
        await DraftTransactionService.markAsRecorded(selectedDraft.id, transactionId);
      }
      await BackgroundService.markReconciliationReview();
      setShowConfirmModal(false);
      await loadDrafts();
      Alert.alert('Success', 'Transaction recorded!');
    } catch (error) {
      console.error('Error recording transaction:', error);
      Alert.alert('Error', 'Failed to record transaction');
    } finally {
      setIsRecording(false);
    }
  };

  const handleClearAll = () => {
    Alert.alert(
      'Clear All Drafts',
      'Are you sure you want to remove all draft transactions? This will not affect confirmed transactions.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            try {
              await DraftTransactionService.clearAll();
              await loadDrafts();
            } catch (e) {
              Alert.alert('Error', 'Failed to clear drafts.');
            }
          }
        }
      ]
    );
  };

  const handleDeleteDraft = (draftId: string) => {
    const confirmDelete = async () => {
      try {
        await DraftTransactionService.delete(draftId);
        await loadDrafts();
      } catch (e) {
        Alert.alert('Error', 'Failed to delete draft.');
      }
    };

    if (Platform.OS === 'web') {
      if (confirm('Are you sure you want to delete this draft?')) {
        void confirmDelete();
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

  const unrecordedCount = drafts.filter(d => d.status === 'PENDING').length;
  const confirmCategoryType = selectedDraft?.type === 'INCOME' ? 'income' : 'expense';
  const confirmCategories = categories.filter((category) => category.type === confirmCategoryType);
  const confirmRootCategories = confirmCategories.filter((category) => !category.parentId);
  const getConfirmChildCategories = (parentId: string) =>
    confirmCategories.filter((category) => category.parentId === parentId);

  useEffect(() => {
    if (!selectedDraft) {
      return;
    }

    if (confirmCategories.length === 0) {
      return;
    }

    const hasValidSelection = confirmCategories.some((category) => category.name === editedCategory);
    if (hasValidSelection) {
      return;
    }

    const matchingDraftCategory = confirmCategories.find((category) => category.name === selectedDraft.category);
    setEditedCategory((matchingDraftCategory ?? confirmCategories[0]).name);
  }, [categories, confirmCategories, editedCategory, selectedDraft]);

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
          <View className="flex-row gap-2">
            <TouchableOpacity onPress={() => setShowOptions(!showOptions)} className="w-10 h-10 bg-white/20 rounded-xl justify-center items-center">
              <FontAwesome name="sliders" size={18} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleClearAll} className="w-10 h-10 bg-white/20 rounded-xl justify-center items-center">
              <FontAwesome name="trash" size={18} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleRefresh} className="w-10 h-10 bg-white/20 rounded-xl justify-center items-center">
              <FontAwesome name="refresh" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Account Info */}
        <View className="bg-white/10 backdrop-blur-lg rounded-2xl p-4">
          <Text className="text-white/80 text-sm mb-1">{account?.name || 'All SMS Accounts'}</Text>
          <Text className="text-white text-2xl font-bold">
            {account ? formatCurrency(account.balance || 0) : `${unrecordedCount} pending draft${unrecordedCount === 1 ? '' : 's'}`}
          </Text>
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

      {/* Privacy Note */}
      <View className="px-6 py-3 bg-emerald-50 dark:bg-emerald-900/10 border-b border-emerald-100 dark:border-emerald-800">
        <View className="flex-row items-center">
          <FontAwesome name="shield" size={14} color="#059669" />
          <Text className="text-emerald-700 dark:text-emerald-400 text-xs font-medium ml-2">
            Privacy: SMS messages are parsed locally on your device.
          </Text>
        </View>
      </View>

      {/* Sync Progress Bar */}
      {syncStatus.progress > 0 && syncStatus.progress < 100 && (
        <View className="bg-white dark:bg-slate-900 px-6 py-2 border-b border-slate-100 dark:border-slate-800">
          <View className="flex-row justify-between items-center mb-1">
            <Text className="text-slate-500 text-[10px] font-bold uppercase">{syncStatus.status}</Text>
            <Text className="text-primary-600 dark:text-primary-400 text-[10px] font-bold">{syncStatus.progress}%</Text>
          </View>
          <View className="w-full h-1 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
            <View className="h-full bg-primary-500" style={{ width: `${syncStatus.progress}%` }} />
          </View>
        </View>
      )}

      {/* View Options Panel */}
      {showOptions && (
        <View className="bg-white dark:bg-slate-900 px-6 py-4 border-b border-slate-100 dark:border-slate-800">
          <View className="mb-4">
            <Text className="text-slate-500 text-[10px] font-bold uppercase mb-2">Filter by Type</Text>
            <View className="flex-row gap-2">
              {(['all', 'income', 'expense'] as const).map(t => (
                <TouchableOpacity
                  key={t}
                  onPress={() => setTypeFilter(t)}
                  className={`px-4 py-2 rounded-lg border ${typeFilter === t ? 'bg-primary-500 border-primary-500' : 'border-slate-200 dark:border-slate-700'}`}
                >
                  <Text className={`text-xs capitalize ${typeFilter === t ? 'text-white' : 'text-slate-600 dark:text-slate-400'}`}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View>
            <Text className="text-slate-500 text-[10px] font-bold uppercase mb-2">Group By</Text>
            <View className="flex-row flex-wrap gap-2">
              {(['none', 'date', 'month', 'year', 'type'] as const).map(g => (
                <TouchableOpacity
                  key={g}
                  onPress={() => setGroupingMode(g)}
                  className={`px-4 py-2 rounded-lg border ${groupingMode === g ? 'bg-indigo-500 border-indigo-500' : 'border-slate-200 dark:border-slate-700'}`}
                >
                  <Text className={`text-xs capitalize ${groupingMode === g ? 'text-white' : 'text-slate-600 dark:text-slate-400'}`}>{g}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      )}

      <View className="px-6 py-4 flex-row justify-between items-center bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800">
        <View className="flex-row bg-slate-100 dark:bg-slate-800 p-1 rounded-xl flex-1 mr-4">
          {(['unrecorded', 'all', 'recorded'] as const).map((f: 'unrecorded' | 'all' | 'recorded') => (
            <TouchableOpacity
              key={f}
              onPress={() => setFilter(f)}
              className={`flex-1 py-2 rounded-lg items-center ${filter === f ? 'bg-white dark:bg-slate-700 shadow-sm' : ''
                }`}
            >
              <Text
                className={`text-xs font-bold capitalize ${filter === f ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'
                  }`}
              >
                {f}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity onPress={handleRefresh} disabled={refreshing}>
          <FontAwesome
            name="refresh"
            size={16}
            color={refreshing ? '#94a3b8' : '#64748b'}
          />
        </TouchableOpacity>
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
        ) : filteredDrafts.length === 0 ? (
          <View className="items-center justify-center mt-20">
            <View className="w-20 h-20 bg-slate-100 dark:bg-slate-800 rounded-full justify-center items-center mb-4">
              <FontAwesome name="inbox" size={32} color="#cbd5e1" />
            </View>
            <Text className="text-slate-900 dark:text-white font-bold text-lg mb-2">No Transactions</Text>
            <Text className="text-slate-400 text-sm text-center">
              {filter === 'unrecorded'
                ? 'No pending SMS transactions match your filters'
                : 'No SMS transactions found'}
            </Text>
          </View>
        ) : (
          getGroupedDrafts().map((group, groupIdx) => (
            <View key={groupIdx} className="mb-6">
              {group.title ? (
                <View className="flex-row items-center mb-4 mt-2">
                  <View className="h-[1px] flex-1 bg-slate-200 dark:bg-slate-800" />
                  <Text className="mx-4 text-slate-400 text-[10px] font-bold uppercase tracking-wider">{group.title}</Text>
                  <View className="h-[1px] flex-1 bg-slate-200 dark:bg-slate-800" />
                </View>
              ) : null}

              {group.data.map((draft: DraftTransaction) => {
                const isIncome = draft.type === 'INCOME';
                const isRecorded = draft.status === 'RECORDED';

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
                          {isRecorded ? 'Recorded' : 'Unrecorded'}
                        </Text>
                      </View>
                      <View className="flex-row items-center gap-3">
                        <TouchableOpacity
                          onPress={() => { setSelectedDraft(draft); setShowPreviewModal(true); }}
                          className="p-2 bg-slate-100 dark:bg-slate-700 rounded-lg"
                        >
                          <FontAwesome name="envelope-o" size={14} color="#64748b" />
                        </TouchableOpacity>
                        <Text className="text-slate-400 text-xs">{formatDate(draft.date)}</Text>
                      </View>
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
                    {draft.status === 'PENDING' && (
                      <View className="flex-row gap-2">
                        <TouchableOpacity
                          onPress={() => openConfirmModal(draft)}
                          className="flex-1 bg-primary-500 py-3 rounded-xl items-center"
                        >
                          <Text className="text-white font-bold">Record Transaction</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => handleReject(draft.id)}
                          className="bg-red-50 dark:bg-red-900/30 px-4 py-3 rounded-xl items-center"
                        >
                          <FontAwesome name="ban" size={16} color="#ef4444" />
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          ))
        )}        <View className="h-8" />
      </ScrollView>

      {/* Raw SMS Preview Modal */}
      <Modal
        visible={showPreviewModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowPreviewModal(false)}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setShowPreviewModal(false)}
          className="flex-1 bg-black/60 justify-center items-center px-6"
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={(e) => e.stopPropagation()}
            className="bg-white dark:bg-slate-900 rounded-3xl p-6 w-full shadow-2xl"
          >
            <View className="flex-row justify-between items-center mb-4">
              <View className="flex-row items-center">
                <View className="w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-lg justify-center items-center mr-3">
                  <FontAwesome name="envelope" size={14} color="#3b82f6" />
                </View>
                <Text className="text-slate-900 dark:text-white text-lg font-bold">Original Message</Text>
              </View>
              <TouchableOpacity onPress={() => setShowPreviewModal(false)}>
                <FontAwesome name="times" size={20} color="#94a3b8" />
              </TouchableOpacity>
            </View>

            <View className="bg-slate-50 dark:bg-slate-800 rounded-2xl p-4 mb-6">
              <Text className="text-slate-700 dark:text-slate-300 text-base leading-6 font-mono">
                {selectedDraft?.raw_sms}
              </Text>
            </View>

            <TouchableOpacity
              onPress={() => setShowPreviewModal(false)}
              className="bg-slate-200 dark:bg-slate-700 py-4 rounded-xl"
            >
              <Text className="text-slate-700 dark:text-slate-300 font-bold text-center">Close</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Confirmation & Learning Modal */}
      <Modal
        visible={showConfirmModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowConfirmModal(false)}
      >
        <View className="flex-1 bg-black/60 justify-end">
          <View className="bg-white dark:bg-slate-900 rounded-t-[40px] p-6 shadow-2xl pb-10">
            <View className="w-12 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full self-center mb-6" />

            <View className="flex-row justify-between items-center mb-6">
              <Text className="text-slate-900 dark:text-white text-2xl font-bold">Confirm Transaction</Text>
              <TouchableOpacity onPress={() => setShowConfirmModal(false)}>
                <FontAwesome name="times-circle" size={24} color="#94a3b8" />
              </TouchableOpacity>
            </View>

            <ScrollView className="max-h-[60vh]" showsVerticalScrollIndicator={false}>
              {/* Key Details Row */}
              <View className="flex-row gap-3 mb-6">
                <View className="flex-1 bg-slate-50 dark:bg-slate-800 p-4 rounded-2xl">
                  <Text className="text-slate-500 text-xs mb-1 uppercase font-bold">Type</Text>
                  <Text className={`font-bold text-lg ${selectedDraft?.type === 'INCOME' ? 'text-green-600' : 'text-red-500'}`}>
                    {selectedDraft?.type}
                  </Text>
                </View>
                <View className="flex-1 bg-slate-50 dark:bg-slate-800 p-4 rounded-2xl">
                  <Text className="text-slate-500 text-xs mb-1 uppercase font-bold">Amount</Text>
                  <Text className="text-slate-900 dark:text-white font-bold text-lg">
                    {formatCurrency(selectedDraft?.amount || 0)}
                  </Text>
                </View>
              </View>

              {/* Editable Fields */}
              <View className="mb-6">
                <Text className="text-slate-500 text-sm font-bold mb-2">Description / Merchant</Text>
                <TextInput
                  value={editedDescription}
                  onChangeText={setEditedDescription}
                  className="bg-slate-50 dark:bg-slate-800 p-4 rounded-xl text-slate-900 dark:text-white text-base border border-slate-100 dark:border-slate-700"
                  placeholder="e.g. Starbucks"
                />
                <Text className="text-[10px] text-slate-400 mt-1 italic">
                  * App will learn this mapping for future syncs
                </Text>
              </View>

              <View className="mb-6">
                <Text className="text-slate-500 text-sm font-bold mb-2">Category</Text>
                <View className="bg-slate-50 dark:bg-slate-800 rounded-2xl p-4">
                  <Text className="text-[11px] text-slate-400 uppercase font-bold mb-3">
                    {selectedDraft?.type === 'INCOME' ? 'Income categories' : 'Expense categories'}
                  </Text>
                  <ScrollView showsVerticalScrollIndicator={false} className="max-h-64" nestedScrollEnabled>
                    {confirmRootCategories.map((category) => (
                      <View key={category.id} className="mb-3">
                        <TouchableOpacity
                          className={`w-full items-center p-4 rounded-2xl border-2 ${editedCategory === category.name
                            ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-500'
                            : 'bg-white dark:bg-slate-900 border-transparent'
                            }`}
                          onPress={() => setEditedCategory(category.name)}
                        >
                          <View className="flex-row items-center w-full">
                            <View
                              className="w-10 h-10 rounded-2xl justify-center items-center mr-3"
                              style={{ backgroundColor: category.color + '20' }}
                            >
                              <CategoryIcon icon={category.icon} size={18} color={category.color} />
                            </View>
                            <View className="flex-1">
                              <Text className="text-slate-900 dark:text-white text-sm font-semibold text-left">
                                {category.name}
                              </Text>
                            </View>
                            {editedCategory === category.name && (
                              <FontAwesome name="check" size={16} color="#6366f1" />
                            )}
                          </View>
                        </TouchableOpacity>

                        {getConfirmChildCategories(category.id).map((childCategory) => (
                          <TouchableOpacity
                            key={childCategory.id}
                            className={`w-full items-center p-3 rounded-xl ml-8 mt-2 border-2 ${editedCategory === childCategory.name
                              ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-500'
                              : 'bg-slate-100 dark:bg-slate-700 border-transparent'
                              }`}
                            onPress={() => setEditedCategory(childCategory.name)}
                          >
                            <View className="flex-row items-center w-full">
                              <View className="w-1 h-4 bg-slate-300 dark:bg-slate-600 mr-2 rounded-full" />
                              <View
                                className="w-8 h-8 rounded-xl justify-center items-center mr-3"
                                style={{ backgroundColor: childCategory.color + '20' }}
                              >
                                <CategoryIcon icon={childCategory.icon} size={14} color={childCategory.color} />
                              </View>
                              <View className="flex-1">
                                <Text className="text-slate-700 dark:text-slate-300 text-xs font-medium text-left">
                                  {childCategory.name}
                                </Text>
                              </View>
                              {editedCategory === childCategory.name && (
                                <FontAwesome name="check" size={12} color="#6366f1" />
                              )}
                            </View>
                          </TouchableOpacity>
                        ))}
                      </View>
                    ))}
                  </ScrollView>
                </View>
              </View>

              {/* Technical Details */}
              <View className="bg-slate-50 dark:bg-slate-800 rounded-2xl p-4 mb-6">
                <View className="flex-row justify-between mb-2">
                  <Text className="text-slate-500 text-sm">Date</Text>
                  <Text className="text-slate-900 dark:text-white font-medium">
                    {formatDate(selectedDraft?.date || 0)} {formatTime(selectedDraft?.date || 0)}
                  </Text>
                </View>
                {selectedDraft?.fees && (
                  <View className="flex-row justify-between mb-2">
                    <Text className="text-slate-500 text-sm">Bank Fees</Text>
                    <Text className="text-slate-900 dark:text-white font-medium">{formatCurrency(selectedDraft.fees)}</Text>
                  </View>
                )}
                {selectedDraft?.tax && (
                  <View className="flex-row justify-between mb-2">
                    <Text className="text-slate-500 text-sm">Tax / VAT</Text>
                    <Text className="text-slate-900 dark:text-white font-medium">{formatCurrency(selectedDraft.tax)}</Text>
                  </View>
                )}
                {selectedDraft?.suggested_balance && (
                  <View className="flex-row justify-between mb-2">
                    <Text className="text-slate-500 text-sm">Expected Balance</Text>
                    <Text className="text-blue-600 dark:text-blue-400 font-bold">{formatCurrency(selectedDraft.suggested_balance)}</Text>
                  </View>
                )}
                {selectedDraft?.reference_number && (
                  <View className="flex-row justify-between">
                    <Text className="text-slate-500 text-sm">Reference</Text>
                    <Text className="text-slate-900 dark:text-white font-mono text-xs">{selectedDraft.reference_number}</Text>
                  </View>
                )}
              </View>

              {/* Original Message Ref */}
              <View className="mb-8">
                <Text className="text-slate-500 text-sm font-bold mb-2">Source Message</Text>
                <View className="bg-slate-100 dark:bg-slate-800/50 p-3 rounded-xl border border-dotted border-slate-300 dark:border-slate-700">
                  <Text className="text-slate-500 dark:text-slate-400 text-xs italic">
                    "{selectedDraft?.raw_sms}"
                  </Text>
                </View>
              </View>
            </ScrollView>

            <TouchableOpacity
              onPress={handleRecordConfirmed}
              disabled={isRecording}
              className={`py-4 rounded-2xl flex-row justify-center items-center ${isRecording ? 'bg-slate-400' : 'bg-primary-500'}`}
            >
              <FontAwesome name="check-circle" size={18} color="#fff" className="mr-2" />
              <Text className="text-white font-bold text-lg ml-2">
                {isRecording ? 'Recording...' : 'Record Transaction'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}
