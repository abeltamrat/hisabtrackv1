import { useAppSettings } from '@/contexts/AppSettingsContext';
import { useTransactions } from '@/context/TransactionContext';
import CategoryIcon from '@/components/CategoryIcon';
import ScreenInfoCard from '@/components/ScreenInfoCard';
import { BackgroundService } from '@/services/BackgroundService';
import { DraftTransaction, DraftTransactionService } from '@/services/DraftTransactionService';
import { SMSLearningService } from '@/services/SMSLearningService';
import { AppDispatch, RootState } from '@/store';
import { fetchAccounts } from '@/store/slices/accountsSlice';
import { addTransaction, fetchTransactions } from '@/store/slices/transactionsSlice';
import { addLoan } from '@/store/slices/loansSlice';
import { FontAwesome } from '@expo/vector-icons';
import { SMSSyncService } from '@/services/SMSSyncService';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Modal, Platform, RefreshControl, ScrollView, SectionList, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Alert } from '@/utils/alert';
import FormSheet from '@/components/FormSheet';
import { useDispatch, useSelector } from 'react-redux';
import { parseTagInput } from '@/utils/tags';

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

export default function DraftTransactionsScreen() {
  const router = useRouter();
  const dispatch = useDispatch<AppDispatch>();
  const params = useLocalSearchParams();
  const accountId = typeof params.accountId === 'string' ? params.accountId : undefined;
  const draftIdParam = typeof params.draftId === 'string' ? params.draftId : undefined;
  const shouldRecalibrate = params.recalibrate === '1';
  const recalibrationStarted = useRef(false);

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
  const [note, setNote] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordAsLoan, setRecordAsLoan] = useState(false);
  const [loanCounterparty, setLoanCounterparty] = useState('');
  const [loanDueDate, setLoanDueDate] = useState('');
  const [syncStatus, setSyncStatus] = useState({ status: 'Idle', progress: 0 });

  // Bulk selection
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<'record' | 'reject' | null>(null);
  const [showBulkReviewModal, setShowBulkReviewModal] = useState(false);
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);

  // Filter & Grouping States
  const [typeFilter, setTypeFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [groupingMode, setGroupingMode] = useState<'none' | 'date' | 'month' | 'year' | 'type'>('date');
  const [showOptions, setShowOptions] = useState(false);

  const uniqueTags = useMemo(() => {
    const tagsSet = new Set<string>();
    transactions.forEach(t => {
      if (t.tags && Array.isArray(t.tags)) {
        t.tags.forEach(tag => {
          if (tag && typeof tag === 'string') {
            tagsSet.add(tag.trim().toLowerCase());
          }
        });
      }
    });
    return Array.from(tagsSet).sort();
  }, [transactions]);

  const filteredDrafts = useMemo(() => {
    return drafts.filter(d => {
      if (typeFilter === 'income') return d.type === 'INCOME';
      if (typeFilter === 'expense') return d.type === 'EXPENSE';
      return true;
    });
  }, [drafts, typeFilter]);

  const groupedDrafts = useMemo(() => {
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
  }, [filteredDrafts, groupingMode]);

  useEffect(() => {
    SMSSyncService.setSyncStatusListener((status) => {
      if (!accountId || status.accountId === accountId) {
        setSyncStatus({ status: status.status, progress: status.progress });
      }
    });
    return () => SMSSyncService.clearSyncStatusListener();
  }, [accountId]);

  useEffect(() => {
    void loadDrafts();
    dispatch(fetchTransactions());
    if (accountId) {
      void checkInitialSync();
    }
    void BackgroundService.markReconciliationReview();
  }, [accountId, filter]);

  useEffect(() => {
    if (!shouldRecalibrate || !account || recalibrationStarted.current) return;
    recalibrationStarted.current = true;
    void handleSync(false, 30).then(() => {
      Alert.alert(
        'Ready to teach',
        `Review ${account.name}'s SMS drafts below. Correct the description or category before recording, and HisabTrack will learn your choice.`
      );
    });
  }, [shouldRecalibrate, account]);

  // When navigated from a notification tap, auto-open the confirm modal for that draft
  useEffect(() => {
    if (!draftIdParam || loading) return;
    const target = drafts.find(d => d.id === draftIdParam && d.status === 'PENDING');
    if (target) {
      setSelectedDraft(target);
      setEditedDescription(target.description);
      setEditedCategory(target.category);
      setNote('');
      setTagsInput('');
      setShowConfirmModal(true);
    }
  }, [draftIdParam, loading, drafts]);

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

  const handleSync = async (historical: boolean = false, historicalDays?: number) => {
    setRefreshing(true);
    try {
      if (account) {
        const result = await SMSSyncService.syncAccountSMS(account, transactions, {
          historicalDays: historicalDays ?? (historical ? 90 : undefined),
          allAccounts: accounts,
        });
        if (result.failed) {
          Alert.alert('Sync Problem', 'Some SMS messages could not be read. Pull down to try again.');
        }
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

  const handleResyncWithHistory = () => {
    if (!account) return;
    Alert.alert(
      'Resync History',
      'How far back should the app scan for SMS transactions?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: '30 days', onPress: () => handleSync(false, 30) },
        { text: '90 days', onPress: () => handleSync(false, 90) },
        { text: '180 days', onPress: () => handleSync(false, 180) },
        { text: '1 year', onPress: () => handleSync(false, 365) },
      ]
    );
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

  const handleToggleTag = (tagToToggle: string) => {
    const currentTags = parseTagInput(tagsInput) || [];
    const exists = currentTags.some(t => t.toLowerCase() === tagToToggle.toLowerCase());
    let newTags: string[];
    if (exists) {
      newTags = currentTags.filter(t => t.toLowerCase() !== tagToToggle.toLowerCase());
    } else {
      newTags = [...currentTags, tagToToggle];
    }
    setTagsInput(newTags.join(', '));
  };

  const openConfirmModal = (draft: DraftTransaction) => {
    setSelectedDraft(draft);
    setEditedDescription(draft.description);
    setEditedCategory(draft.category);
    setNote('');
    setTagsInput('');
    setRecordAsLoan(!!draft.is_loan_disbursement);
    setLoanCounterparty(draft.sender_receiver || 'SMS loan');
    const defaultDue = new Date(draft.date + 30 * 24 * 60 * 60 * 1000);
    setLoanDueDate(defaultDue.toISOString().slice(0, 10));
    setShowConfirmModal(true);
  };

  const handleRecordConfirmed = async () => {
    if (!selectedDraft) return;

    setIsRecording(true);
    try {
      // 1. Learn / reinforce rules
      const hasCorrections =
        editedDescription !== selectedDraft.description ||
        editedCategory !== selectedDraft.category;
      const learnedSender = selectedDraft.sms_sender || account?.sms_number?.split(',')[0] || '';

      // Transfers carry the forced "Transfer" category — learning them would
      // poison merchant rules that regular drafts from the same sender rely on.
      if (learnedSender && !selectedDraft.is_transfer && (selectedDraft.sender_receiver || selectedDraft.reference_number)) {
        await SMSLearningService.learn({
          accountId: selectedDraft.account_id,
          sender: learnedSender,
          rawMerchant: selectedDraft.sender_receiver,
          referenceNumber: selectedDraft.reference_number,
          correctedDescription: editedDescription,
          correctedCategory: editedCategory,
          isCorrection: hasCorrections,
        });
      }

      // 2. Create transaction
      const finalDescription = note.trim()
        ? `${editedDescription.trim()} (${note.trim()})`
        : editedDescription.trim();

      const parsedTags = parseTagInput(tagsInput);

      // Outgoing leg knows its destination; incoming leg knows its source —
      // either one records as a single TRANSFER from source to destination.
      const isTransferDraft = selectedDraft.is_transfer && selectedDraft.transfer_to_account_id;
      const isIncomingTransferDraft = !isTransferDraft && selectedDraft.is_transfer && selectedDraft.transfer_from_account_id;
      const result = await dispatch(addTransaction({
        account_id: isIncomingTransferDraft ? selectedDraft.transfer_from_account_id! : selectedDraft.account_id,
        type: (isTransferDraft || isIncomingTransferDraft) ? 'TRANSFER' : selectedDraft.type,
        ...(isTransferDraft ? { to_account_id: selectedDraft.transfer_to_account_id } : {}),
        ...(isIncomingTransferDraft ? { to_account_id: selectedDraft.account_id } : {}),
        // The incoming leg carries the net received; TRANSFER stores the gross
        // source debit and the DB nets fees/tax off the destination credit.
        amount: isIncomingTransferDraft
          ? selectedDraft.amount + (selectedDraft.fees ?? 0) + (selectedDraft.tax ?? 0)
          : selectedDraft.amount,
        category: editedCategory,
        description: finalDescription,
        tags: parsedTags,
        date: selectedDraft.date,
        sender_receiver: selectedDraft.sender_receiver,
        reference_number: selectedDraft.reference_number,
        sms_id: selectedDraft.sms_id,
        fees: selectedDraft.fees,
        tax: selectedDraft.tax,
        receipt_url: selectedDraft.receipt_url,
      }));

      if (addTransaction.rejected.match(result)) {
        Alert.alert('Error', 'Failed to record transaction. Please try again.');
        return;
      }

      await dispatch(fetchAccounts());

      const transactionId = (result.payload as any)?.id;
      if (transactionId) {
        await DraftTransactionService.markAsRecorded(selectedDraft.id, transactionId);
        // The opposite leg of a paired self-transfer is covered by the same
        // TRANSFER transaction — close it too so it can't be double-recorded.
        if (selectedDraft.paired_draft_id) {
          await DraftTransactionService.markAsRecorded(selectedDraft.paired_draft_id, transactionId);
        }
      }

      // Loan creation tracks the liability/receivable only; it does not mutate
      // the account balance, which was already updated by the cash transaction.
      let loanCreated = false;
      if (recordAsLoan && !selectedDraft.is_transfer) {
        const loanPrincipal = selectedDraft.type === 'EXPENSE'
          ? Math.max(0, Math.round((selectedDraft.amount - (selectedDraft.fees ?? 0) - (selectedDraft.tax ?? 0)) * 100) / 100)
          : selectedDraft.amount;
        const parsedDueDate = new Date(`${loanDueDate}T12:00:00`).getTime();
        const dueDate = Number.isFinite(parsedDueDate)
          ? parsedDueDate
          : selectedDraft.date + 30 * 24 * 60 * 60 * 1000;
        const loanResult = await dispatch(addLoan({
          type: selectedDraft.type === 'INCOME' ? 'BORROWED' : 'LENT',
          principal_amount: loanPrincipal,
          interest_rate: 0,
          start_date: selectedDraft.date,
          due_date: dueDate,
          lender_borrower_name: loanCounterparty.trim() || selectedDraft.sender_receiver || 'SMS loan',
          status: 'ACTIVE',
          remaining_balance: loanPrincipal,
        }));
        loanCreated = addLoan.fulfilled.match(loanResult);
      }
      await BackgroundService.markReconciliationReview();
      setShowConfirmModal(false);
      await loadDrafts();
      Alert.alert(
        'Success',
        recordAsLoan
          ? loanCreated
            ? `Transaction recorded and ${selectedDraft.type === 'INCOME' ? 'borrowed loan' : 'loan given'} added to Loans.`
            : 'Transaction recorded, but the loan record could not be created. You can add it manually from Loans.'
          : 'Transaction recorded!'
      );
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

  // ── Bulk selection helpers ──────────────────────────────────────────────────
  const pendingDrafts = filteredDrafts.filter(d => d.status === 'PENDING');
  const selectedDrafts = pendingDrafts.filter(d => selectedIds.has(d.id));

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(pendingDrafts.map(d => d.id)));
  const clearSelection = () => setSelectedIds(new Set());

  const exitSelectionMode = () => {
    setIsSelectionMode(false);
    setSelectedIds(new Set());
  };

  const openBulkReview = (action: 'record' | 'reject') => {
    setBulkAction(action);
    setShowBulkReviewModal(true);
  };

  const handleBulkRecord = async () => {
    setIsBulkProcessing(true);
    let successCount = 0;
    // Legs already closed as the pair of an earlier-recorded draft in this batch.
    const closedPairIds = new Set<string>();
    for (const draft of selectedDrafts) {
      if (closedPairIds.has(draft.id)) {
        successCount++;
        continue;
      }
      try {
        const isBulkTransfer = draft.is_transfer && draft.transfer_to_account_id;
        const isBulkIncomingTransfer = !isBulkTransfer && draft.is_transfer && draft.transfer_from_account_id;
        const result = await dispatch(addTransaction({
          account_id: isBulkIncomingTransfer ? draft.transfer_from_account_id! : draft.account_id,
          type: (isBulkTransfer || isBulkIncomingTransfer) ? 'TRANSFER' : draft.type,
          ...(isBulkTransfer ? { to_account_id: draft.transfer_to_account_id } : {}),
          ...(isBulkIncomingTransfer ? { to_account_id: draft.account_id } : {}),
          amount: isBulkIncomingTransfer
            ? draft.amount + (draft.fees ?? 0) + (draft.tax ?? 0)
            : draft.amount,
          category: draft.category,
          description: draft.description,
          tags: [],
          date: draft.date,
          sender_receiver: draft.sender_receiver,
          reference_number: draft.reference_number,
          sms_id: draft.sms_id,
          fees: draft.fees,
          tax: draft.tax,
          receipt_url: draft.receipt_url,
        }));
        if (!addTransaction.rejected.match(result)) {
          const transactionId = (result.payload as any)?.id;
          if (transactionId) {
            await DraftTransactionService.markAsRecorded(draft.id, transactionId);
            if (draft.paired_draft_id) {
              await DraftTransactionService.markAsRecorded(draft.paired_draft_id, transactionId);
              closedPairIds.add(draft.paired_draft_id);
            }
          }
          // Reinforce (not correct) learning rules: accepting a draft as-is is a
          // confirmation the suggested description/category were right.
          if (!draft.is_transfer && draft.sms_sender && (draft.sender_receiver || draft.reference_number)) {
            await SMSLearningService.learn({
              accountId: draft.account_id,
              sender: draft.sms_sender,
              rawMerchant: draft.sender_receiver,
              referenceNumber: draft.reference_number,
              correctedDescription: draft.description,
              correctedCategory: draft.category,
              isCorrection: false,
            });
          }
          successCount++;
        }
      } catch {}
    }
    await dispatch(fetchAccounts());
    await BackgroundService.markReconciliationReview();
    setIsBulkProcessing(false);
    setShowBulkReviewModal(false);
    exitSelectionMode();
    await loadDrafts();
    Alert.alert('Done', `Recorded ${successCount} of ${selectedDrafts.length} transactions.`);
  };

  const handleBulkReject = async () => {
    setIsBulkProcessing(true);
    let successCount = 0;
    for (const draft of selectedDrafts) {
      try {
        await DraftTransactionService.updateStatus(draft.id, 'REJECTED');
        successCount++;
      } catch {}
    }
    setIsBulkProcessing(false);
    setShowBulkReviewModal(false);
    exitSelectionMode();
    await loadDrafts();
    Alert.alert('Done', `Ignored ${successCount} transactions.`);
  };
  // ───────────────────────────────────────────────────────────────────────────

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
        colors={['#4f46e5', '#4338ca']}
        className="px-6 pt-6 pb-8 rounded-b-[32px]"
        style={{ elevation: 4 }}
      >
        <View className="flex-row justify-between items-center mb-4">
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} className="w-10 h-10 bg-white/20 rounded-xl justify-center items-center">
            <FontAwesome name="arrow-left" size={18} color="#fff" />
          </TouchableOpacity>
          <Text className="text-white text-xl font-bold">SMS Transactions</Text>
          <View className="flex-row gap-2">
            {isSelectionMode ? (
              <>
                <TouchableOpacity onPress={selectAll} className="px-3 h-10 bg-white/20 rounded-xl justify-center items-center">
                  <Text className="text-white text-xs font-bold">All</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={exitSelectionMode} className="px-3 h-10 bg-white/30 rounded-xl justify-center items-center">
                  <Text className="text-white text-xs font-bold">Done</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Select multiple drafts" onPress={() => setIsSelectionMode(true)} className="w-10 h-10 bg-white/20 rounded-xl justify-center items-center">
                  <FontAwesome name="check-square-o" size={18} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Draft options" accessibilityState={{ expanded: showOptions }} onPress={() => setShowOptions(!showOptions)} className="w-10 h-10 bg-white/20 rounded-xl justify-center items-center">
                  <FontAwesome name="sliders" size={18} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Delete" onPress={handleClearAll} className="w-10 h-10 bg-white/20 rounded-xl justify-center items-center">
                  <FontAwesome name="trash" size={18} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Refresh" onPress={handleRefresh} className="w-10 h-10 bg-white/20 rounded-xl justify-center items-center">
                  <FontAwesome name="refresh" size={18} color="#fff" />
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>

        {/* Account Info */}
        <View className="bg-white/10 backdrop-blur-lg rounded-2xl p-4">
          <Text className="text-white/90 text-sm mb-1">{account?.name || 'All SMS Accounts'}</Text>
          <Text adjustsFontSizeToFit numberOfLines={1} minimumFontScale={0.6} className="text-white text-2xl font-bold">
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
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center flex-1 mr-3">
            <FontAwesome name="shield" size={14} color="#059669" />
            <Text className="text-emerald-700 dark:text-emerald-400 text-[11px] font-medium ml-2 flex-1">
              Parsed on-device first. AI fallback is used only when enabled in Settings.
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => router.push({
              pathname: '/manage-sms-rules',
              params: accountId ? { accountId } : {},
            } as any)}
            className="bg-emerald-600 rounded-xl px-3 py-2 flex-row items-center"
          >
            <FontAwesome name="graduation-cap" size={12} color="#fff" />
            <Text className="text-white text-[11px] font-bold ml-1.5">Teach</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Sync Progress Bar */}
      {syncStatus.progress > 0 && syncStatus.progress < 100 && (
        <View className="bg-white dark:bg-slate-900 px-6 py-2 border-b border-slate-100 dark:border-slate-800">
          <View className="flex-row justify-between items-center mb-1">
            <Text className="text-slate-500 dark:text-slate-400 text-[10px] font-bold uppercase">{syncStatus.status}</Text>
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
            <Text className="text-slate-500 dark:text-slate-400 text-[10px] font-bold uppercase mb-2">Filter by Type</Text>
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

          <View className="mb-4">
            <Text className="text-slate-500 dark:text-slate-400 text-[10px] font-bold uppercase mb-2">Group By</Text>
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

          {account && (
            <View>
              <Text className="text-slate-500 dark:text-slate-400 text-[10px] font-bold uppercase mb-2">Resync History</Text>
              <TouchableOpacity
                onPress={handleResyncWithHistory}
                disabled={refreshing}
                className="flex-row items-center px-4 py-3 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20"
              >
                <FontAwesome name="history" size={14} color="#6366f1" />
                <Text className="text-indigo-600 dark:text-indigo-400 text-xs font-semibold ml-2">
                  Scan older SMS (choose range)
                </Text>
              </TouchableOpacity>
              <Text className="text-[10px] text-slate-500 mt-1 dark:text-slate-400">
                Use this if your bank SMS are not showing up
              </Text>
            </View>
          )}
        </View>
      )}

      <View className="px-6 py-4 flex-row justify-between items-center bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800">
        <View className="flex-row bg-slate-100 dark:bg-slate-800 p-1 rounded-xl flex-1 mr-4">
          {(['unrecorded', 'all', 'recorded'] as const).map((f: 'unrecorded' | 'all' | 'recorded') => (
            <TouchableOpacity
              key={f}
              onPress={() => setFilter(f)}
              className={`flex-1 py-2 rounded-lg items-center ${filter === f ? 'bg-white dark:bg-slate-700 shadow-sm' : '' }`}
            >
              <Text
                className={`text-xs font-bold capitalize ${filter === f ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500' }`}
              >
                {f}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Refresh" onPress={handleRefresh} disabled={refreshing}>
          <FontAwesome
            name="refresh"
            size={16}
            color={refreshing ? '#94a3b8' : '#64748b'}
          />
        </TouchableOpacity>
      </View>

      {/* Drafts List */}
      {loading ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-slate-500 dark:text-slate-400">Loading...</Text>
        </View>
      ) : filteredDrafts.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <ScreenInfoCard
            icon="inbox"
            title={filter === 'unrecorded' ? 'You are all caught up' : 'No SMS transactions yet'}
            description={filter === 'unrecorded' ? 'There are no pending bank messages waiting for your review.' : 'Connect an SMS-enabled account and sync your inbox to bring transactions here.'}
            suggestions={[
              'Use Process Messages or pull down to scan for new bank SMS.',
              'Review and correct a draft before recording it; the parser learns from your choices.',
              'If a message is missing, open Options and scan older SMS history.',
            ]}
          />
        </View>
      ) : (
        <SectionList
          sections={groupedDrafts}
          keyExtractor={(item) => item.id}
          className="flex-1 px-6"
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
          }
          maxToRenderPerBatch={10}
          windowSize={10}
          initialNumToRender={10}
          removeClippedSubviews={true}
          renderSectionHeader={({ section: { title } }) => title ? (
            <View className="flex-row items-center mb-4 mt-2 bg-slate-50 dark:bg-background-dark py-1">
              <View className="h-[1px] flex-1 bg-slate-200 dark:bg-slate-800" />
              <Text className="mx-4 text-slate-500 text-[10px] font-bold uppercase tracking-wider dark:text-slate-400">{title}</Text>
              <View className="h-[1px] flex-1 bg-slate-200 dark:bg-slate-800" />
            </View>
          ) : null}
          renderItem={({ item: draft }) => {
            const isIncome = draft.type === 'INCOME';
            const isRecorded = draft.status === 'RECORDED';
            const isSelected = selectedIds.has(draft.id);
            const isSelectable = isSelectionMode && !isRecorded;

            const draftAccount = accounts.find((a: any) => a.id === draft.account_id);
            const postBalance = draftAccount
              ? draft.status === 'RECORDED'
                ? draftAccount.balance
                : draftAccount.balance + (draft.type === 'INCOME' ? draft.amount : -draft.amount)
              : null;
            const hasDiscrepancy =
              postBalance !== null &&
              draft.suggested_balance !== undefined &&
              Math.abs(postBalance - draft.suggested_balance) > 0.01;

            return (
              <TouchableOpacity
                activeOpacity={isSelectable ? 0.7 : 1}
                onPress={isSelectable ? () => toggleSelection(draft.id) : undefined}
                className={`bg-white dark:bg-slate-800 rounded-2xl p-4 mb-3 shadow-sm border ${ isSelected ? 'border-indigo-400 dark:border-indigo-500' : isRecorded ? 'border-green-200 dark:border-green-900' : 'border-yellow-200 dark:border-yellow-900' }`}
                style={{ elevation: 2 }}
              >
                {/* Status Badge */}
                <View className="flex-row justify-between items-start mb-3">
                  <View className="flex-row items-center gap-2">
                    {isSelectionMode && !isRecorded && (
                      <View className={`w-6 h-6 rounded-full border-2 justify-center items-center ${ isSelected ? 'bg-indigo-500 border-indigo-500' : 'border-slate-300 dark:border-slate-600' }`}>
                        {isSelected && <FontAwesome name="check" size={10} color="#fff" />}
                      </View>
                    )}
                    <View className={`px-3 py-1 rounded-full ${isRecorded ? 'bg-green-100 dark:bg-green-900/30' : 'bg-yellow-100 dark:bg-yellow-900/30' }`}>
                      <Text className={`text-xs font-bold ${isRecorded ? 'text-green-700 dark:text-green-400' : 'text-yellow-700 dark:text-yellow-400' }`}>
                        {isRecorded ? 'Recorded' : 'Unrecorded'}
                      </Text>
                    </View>
                    {draft.is_transfer && (
                      <View className="px-2 py-1 rounded-full bg-indigo-100 dark:bg-indigo-900/30">
                        <Text className="text-xs font-bold text-indigo-700 dark:text-indigo-400">Transfer</Text>
                      </View>
                    )}
                    {draft.is_loan_disbursement && (
                      <View className="px-2 py-1 rounded-full bg-amber-100 dark:bg-amber-900/30">
                        <Text className="text-xs font-bold text-amber-700 dark:text-amber-400">Loan proceeds</Text>
                      </View>
                    )}
                  </View>
                  <View className="flex-row items-center gap-3">
                    <TouchableOpacity accessibilityRole="button" accessibilityLabel="View original SMS"
                      onPress={() => { setSelectedDraft(draft); setShowPreviewModal(true); }}
                      className="p-2 bg-slate-100 dark:bg-slate-700 rounded-lg"
                    >
                      <FontAwesome name="envelope-o" size={14} color="#64748b" />
                    </TouchableOpacity>
                    <Text className="text-slate-500 text-xs dark:text-slate-400">{formatDate(draft.date)}</Text>
                  </View>
                </View>

                {/* Transaction Details */}
                <View className="flex-row items-center mb-3">
                  <View
                    className={`w-12 h-12 rounded-xl justify-center items-center mr-3 ${draft.is_transfer ? 'bg-indigo-100 dark:bg-indigo-900/30' : isIncome ? 'bg-green-100 dark:bg-green-900/30' : 'bg-red-100 dark:bg-red-900/30' }`}
                  >
                    <FontAwesome
                      name={draft.is_transfer ? 'exchange' : isIncome ? 'arrow-down' : 'arrow-up'}
                      size={18}
                      color={draft.is_transfer ? '#6366f1' : isIncome ? '#10b981' : '#ef4444'}
                    />
                  </View>
                  <View className="flex-1">
                    <Text className="text-slate-900 dark:text-white font-bold text-base mb-1">
                      {draft.description}
                    </Text>
                    <View className="flex-row items-center">
                      <Text className="text-slate-500 text-xs dark:text-slate-400">{draft.category}</Text>
                      <View className="w-1 h-1 bg-slate-300 rounded-full mx-2" />
                      <Text className="text-slate-500 text-xs dark:text-slate-400">{formatTime(draft.date)}</Text>
                    </View>
                  </View>
                  <Text className={`font-bold text-lg ${isIncome ? 'text-green-600' : 'text-red-500' }`}>
                    {isIncome ? '+' : '-'}{formatCurrency(draft.amount)}
                  </Text>
                </View>

                {/* Additional Info */}
                {(draft.fees || draft.tax || draft.reference_number || draft.suggested_balance !== undefined) && (
                  <View className="bg-slate-50 dark:bg-slate-900 rounded-xl p-3 mb-3">
                    {draft.fees && (
                      <View className="flex-row justify-between mb-1">
                        <Text className="text-slate-500 dark:text-slate-400 text-xs">Fee</Text>
                        <Text className="text-slate-700 dark:text-slate-300 text-xs font-semibold">
                          {formatCurrency(draft.fees)}
                        </Text>
                      </View>
                    )}
                    {draft.tax && (
                      <View className="flex-row justify-between mb-1">
                        <Text className="text-slate-500 dark:text-slate-400 text-xs">Tax</Text>
                        <Text className="text-slate-700 dark:text-slate-300 text-xs font-semibold">
                          {formatCurrency(draft.tax)}
                        </Text>
                      </View>
                    )}
                    {draft.reference_number && (
                      <View className="flex-row justify-between mb-1">
                        <Text className="text-slate-500 dark:text-slate-400 text-xs">Ref</Text>
                        <Text className="text-slate-700 dark:text-slate-300 text-xs font-mono">
                          {draft.reference_number}
                        </Text>
                      </View>
                    )}
                    {draft.suggested_balance !== undefined && (
                      <View className="flex-row justify-between mb-1">
                        <Text className="text-slate-500 dark:text-slate-400 text-xs">Stated Bank Bal</Text>
                        <Text className="text-slate-700 dark:text-slate-300 text-xs font-semibold">
                          {formatCurrency(draft.suggested_balance)}
                        </Text>
                      </View>
                    )}
                    {draft.receipt_url && (
                      <TouchableOpacity
                        onPress={() => Linking.openURL(draft.receipt_url!)}
                        className="flex-row items-center mt-1"
                      >
                        <FontAwesome name="external-link" size={11} color="#6366f1" />
                        <Text className="text-indigo-500 text-xs ml-1.5 underline" numberOfLines={1}>
                          View Receipt
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}

                {hasDiscrepancy && (
                  <View className="flex-row items-center bg-red-50 dark:bg-red-950/20 p-2.5 rounded-xl mb-3 border border-red-100 dark:border-red-900/30">
                    <FontAwesome name="exclamation-triangle" size={12} color="#ef4444" />
                    <Text className="text-red-600 dark:text-red-400 text-[10px] ml-2 font-semibold flex-1">
                      Balance Discrepancy: Bank states {formatCurrency(draft.suggested_balance || 0)}, but expected balance is {formatCurrency(postBalance || 0)}.
                    </Text>
                  </View>
                )}

                {/* Actions */}
                {draft.status === 'PENDING' && !isSelectionMode && (
                  <View className="flex-row gap-2">
                    <TouchableOpacity
                      onPress={() => openConfirmModal(draft)}
                      className="flex-1 bg-primary-500 py-3 rounded-xl items-center"
                    >
                      <Text className="text-white font-bold">Record Transaction</Text>
                    </TouchableOpacity>
                    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Ignore"
                      onPress={() => handleReject(draft.id)}
                      className="bg-red-50 dark:bg-red-900/30 px-4 py-3 rounded-xl items-center"
                    >
                      <FontAwesome name="ban" size={16} color="#ef4444" />
                    </TouchableOpacity>
                  </View>
                )}
              </TouchableOpacity>
            );
          }}
          ListFooterComponent={<View className="h-8" />}
        />
      )}

      {/* Bulk Action Bar */}
      {isSelectionMode && (
        <View className="absolute bottom-0 left-0 right-0 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 px-4 py-3 flex-row items-center gap-3" style={{ elevation: 8 }}>
          <View className="flex-1">
            <Text className="text-slate-900 dark:text-white font-bold text-sm">
              {selectedIds.size} selected
            </Text>
            <TouchableOpacity onPress={selectedIds.size === pendingDrafts.length ? clearSelection : selectAll}>
              <Text className="text-indigo-500 text-xs">
                {selectedIds.size === pendingDrafts.length ? 'Deselect all' : `Select all (${pendingDrafts.length})`}
              </Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            onPress={() => openBulkReview('reject')}
            disabled={selectedIds.size === 0}
            className={`px-4 py-3 rounded-xl border ${selectedIds.size === 0 ? 'border-slate-200 dark:border-slate-700' : 'border-red-300 bg-red-50 dark:bg-red-900/20'}`}
          >
            <Text className={`text-sm font-bold ${selectedIds.size === 0 ? 'text-slate-500' : 'text-red-600 dark:text-red-400'}`}>
              Ignore
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => openBulkReview('record')}
            disabled={selectedIds.size === 0}
            className={`px-5 py-3 rounded-xl ${selectedIds.size === 0 ? 'bg-slate-200 dark:bg-slate-700' : 'bg-primary-500'}`}
          >
            <Text className={`text-sm font-bold ${selectedIds.size === 0 ? 'text-slate-500' : 'text-white'} dark:text-slate-400`}>
              Record
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Bulk Review Modal */}
      <Modal
        visible={showBulkReviewModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowBulkReviewModal(false)}
      >
        <View className="flex-1 bg-black/60 justify-end">
          <View className="bg-white dark:bg-slate-900 rounded-t-[32px] shadow-2xl" style={{ maxHeight: '85%' }}>
            {/* Handle */}
            <View className="w-12 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full self-center mt-4 mb-4" />

            {/* Header */}
            <View className="px-5 pb-3 flex-row items-center justify-between">
              <View>
                <Text className="text-slate-900 dark:text-white text-lg font-bold">
                  {bulkAction === 'record' ? 'Record Transactions' : 'Ignore Transactions'}
                </Text>
                <Text className="text-slate-500 text-xs mt-0.5 dark:text-slate-400">
                  {selectedDrafts.length} transaction{selectedDrafts.length !== 1 ? 's' : ''} will be {bulkAction === 'record' ? 'saved to your ledger' : 'moved to rejected'}
                </Text>
              </View>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close" onPress={() => setShowBulkReviewModal(false)} className="p-2">
                <FontAwesome name="times" size={20} color="#94a3b8" />
              </TouchableOpacity>
            </View>

            {/* Column Headers */}
            <View className="flex-row items-center px-5 py-2 bg-slate-50 dark:bg-slate-800 border-t border-b border-slate-100 dark:border-slate-700">
              <View className="w-7" />
              <Text className="text-[10px] font-bold text-slate-500 uppercase w-24 dark:text-slate-400">Amount</Text>
              <Text className="text-[10px] font-bold text-slate-500 uppercase flex-1 dark:text-slate-400">Description</Text>
              <Text className="text-[10px] font-bold text-slate-500 uppercase w-20 text-right dark:text-slate-400">Date</Text>
              <View className="w-6" />
            </View>

            {/* Rows */}
            <ScrollView className="px-5" showsVerticalScrollIndicator={false}>
              {selectedDrafts.map(draft => {
                const isIncome = draft.type === 'INCOME';
                return (
                  <View key={draft.id} className="flex-row items-center py-3 border-b border-slate-50 dark:border-slate-800">
                    {/* Type icon */}
                    <View className={`w-6 h-6 rounded-full justify-center items-center mr-1 ${isIncome ? 'bg-green-100 dark:bg-green-900/40' : 'bg-red-100 dark:bg-red-900/40'}`}>
                      <FontAwesome name={isIncome ? 'arrow-down' : 'arrow-up'} size={9} color={isIncome ? '#10b981' : '#ef4444'} />
                    </View>
                    {/* Amount */}
                    <Text className={`text-sm font-bold w-24 ${isIncome ? 'text-green-600' : 'text-red-500'}`} numberOfLines={1}>
                      {isIncome ? '+' : '-'}{formatCurrency(draft.amount)}
                    </Text>
                    {/* Description + category */}
                    <View className="flex-1 pr-2">
                      <Text className="text-slate-800 dark:text-slate-200 text-xs font-semibold" numberOfLines={1}>{draft.description}</Text>
                      <Text className="text-slate-500 text-[10px] dark:text-slate-400" numberOfLines={1}>{draft.category}</Text>
                    </View>
                    {/* Date */}
                    <Text className="text-slate-500 text-[10px] w-20 text-right dark:text-slate-400">
                      {new Date(draft.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </Text>
                    {/* Remove from selection */}
                    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close"
                      onPress={() => toggleSelection(draft.id)}
                      className="w-6 h-6 ml-1 justify-center items-center"
                    >
                      <FontAwesome name="times-circle" size={14} color="#cbd5e1" />
                    </TouchableOpacity>
                  </View>
                );
              })}
              <View className="h-4" />
            </ScrollView>

            {/* Summary + Actions */}
            <View className="px-5 pt-3 pb-8 border-t border-slate-100 dark:border-slate-800">
              {bulkAction === 'record' && (
                <View className="bg-indigo-50 dark:bg-indigo-900/20 rounded-xl p-3 mb-3 flex-row items-center">
                  <FontAwesome name="info-circle" size={13} color="#6366f1" />
                  <Text className="text-indigo-600 dark:text-indigo-400 text-xs ml-2 flex-1">
                    Transactions will be recorded with their auto-detected category. You can edit individual transactions afterwards.
                  </Text>
                </View>
              )}
              <View className="flex-row gap-3">
                <TouchableOpacity
                  onPress={() => setShowBulkReviewModal(false)}
                  disabled={isBulkProcessing}
                  className="flex-1 py-3.5 rounded-2xl bg-slate-100 dark:bg-slate-800 items-center"
                >
                  <Text className="text-slate-600 dark:text-slate-300 font-bold">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={bulkAction === 'record' ? handleBulkRecord : handleBulkReject}
                  disabled={isBulkProcessing || selectedDrafts.length === 0}
                  className={`flex-1 py-3.5 rounded-2xl items-center ${ isBulkProcessing || selectedDrafts.length === 0 ? 'bg-slate-300 dark:bg-slate-700' : bulkAction === 'record' ? 'bg-primary-500' : 'bg-red-500' }`}
                >
                  <Text className="text-white font-bold">
                    {isBulkProcessing
                      ? 'Processing...'
                      : bulkAction === 'record'
                      ? `Record ${selectedDrafts.length}`
                      : `Ignore ${selectedDrafts.length}`}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>

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
      <FormSheet
        visible={showConfirmModal}
        onClose={() => setShowConfirmModal(false)}
        cardClassName="shadow-2xl"
        accessibilityLabel="Confirm transaction"
      >
        <View>
            <View className="w-12 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full self-center mb-6" />

            <View className="flex-row justify-between items-center mb-6">
              <Text className="text-slate-900 dark:text-white text-2xl font-bold">Confirm Transaction</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close" onPress={() => setShowConfirmModal(false)}>
                <FontAwesome name="times-circle" size={24} color="#94a3b8" />
              </TouchableOpacity>
            </View>

            <ScrollView className="max-h-[60vh]" showsVerticalScrollIndicator={false}>
              {/* Key Details Row */}
              <View className="flex-row gap-3 mb-6">
                <View className="flex-1 bg-slate-50 dark:bg-slate-800 p-4 rounded-2xl">
                  <Text className="text-slate-500 dark:text-slate-400 text-xs mb-1 uppercase font-bold">Type</Text>
                  <Text className={`font-bold text-lg ${selectedDraft?.type === 'INCOME' ? 'text-green-600' : 'text-red-500'}`}>
                    {selectedDraft?.type}
                  </Text>
                </View>
                <View className="flex-1 bg-slate-50 dark:bg-slate-800 p-4 rounded-2xl">
                  <Text className="text-slate-500 dark:text-slate-400 text-xs mb-1 uppercase font-bold">Amount</Text>
                  <Text adjustsFontSizeToFit numberOfLines={1} minimumFontScale={0.6} className="text-slate-900 dark:text-white font-bold text-lg">
                    {formatCurrency(selectedDraft?.amount || 0)}
                  </Text>
                </View>
              </View>

              {selectedDraft?.is_loan_disbursement && (
                <View className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-4 mb-5 flex-row items-start">
                  <FontAwesome name="exclamation-circle" size={18} color="#d97706" />
                  <View className="flex-1 ml-3">
                    <Text className="text-amber-900 dark:text-amber-200 font-bold">Possible borrowed money</Text>
                    <Text className="text-amber-700 dark:text-amber-300 text-xs mt-1 leading-5">
                      The account was credited, but the SMS uses loan or credit language. Record the cash movement as income, then make sure the category is Loan/Debt and add the liability in Loans if it is not already tracked.
                    </Text>
                  </View>
                </View>
              )}

              {!selectedDraft?.is_transfer && (
                <View className={`rounded-2xl p-4 mb-5 border-2 ${recordAsLoan ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-400 dark:border-amber-700' : 'bg-slate-50 dark:bg-slate-800 border-slate-100 dark:border-slate-700'}`}>
                  <TouchableOpacity
                    onPress={() => setRecordAsLoan(!recordAsLoan)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: recordAsLoan }}
                    className="flex-row items-center"
                  >
                    <View className={`w-7 h-7 rounded-lg justify-center items-center mr-3 ${recordAsLoan ? 'bg-amber-500' : 'bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600'}`}>
                      {recordAsLoan && <FontAwesome name="check" size={14} color="#fff" />}
                    </View>
                    <View className="flex-1">
                      <Text className="text-slate-900 dark:text-white font-bold">This is a loan</Text>
                      <Text className="text-slate-500 dark:text-slate-400 text-xs mt-0.5">
                        {selectedDraft?.type === 'INCOME'
                          ? 'Credited account → I borrowed this money'
                          : 'Debited account → I gave this loan'}
                      </Text>
                    </View>
                    <FontAwesome name="handshake-o" size={18} color={recordAsLoan ? '#d97706' : '#94a3b8'} />
                  </TouchableOpacity>

                  {recordAsLoan && (
                    <View className="mt-4 pt-4 border-t border-amber-200 dark:border-amber-800">
                      <Text className="text-slate-600 dark:text-slate-300 text-xs font-bold mb-1.5">
                        {selectedDraft?.type === 'INCOME' ? 'Lender / provider' : 'Borrower'}
                      </Text>
                      <TextInput
                        value={loanCounterparty}
                        onChangeText={setLoanCounterparty}
                        placeholder={selectedDraft?.type === 'INCOME' ? 'Who lent you the money?' : 'Who borrowed the money?'}
                        placeholderTextColor="#94a3b8"
                        className="bg-white dark:bg-slate-800 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3 text-slate-900 dark:text-white mb-3"
                      />
                      <Text className="text-slate-600 dark:text-slate-300 text-xs font-bold mb-1.5">Expected repayment date</Text>
                      <TextInput
                        value={loanDueDate}
                        onChangeText={setLoanDueDate}
                        placeholder="YYYY-MM-DD"
                        placeholderTextColor="#94a3b8"
                        keyboardType="numbers-and-punctuation"
                        className="bg-white dark:bg-slate-800 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3 text-slate-900 dark:text-white"
                      />
                      <Text className="text-amber-700 dark:text-amber-400 text-[10px] mt-2">Interest starts at 0%. You can add interest, reminders, and payment details later from Loans.</Text>
                    </View>
                  )}
                </View>
              )}

              {/* Editable Fields */}
              <View className="mb-6">
                <Text className="text-slate-500 dark:text-slate-400 text-sm font-bold mb-2">Description / Merchant</Text>
                <TextInput
                  value={editedDescription}
                  onChangeText={setEditedDescription}
                  className="bg-slate-50 dark:bg-slate-800 p-4 rounded-xl text-slate-900 dark:text-white text-base border border-slate-100 dark:border-slate-700"
                  placeholder="e.g. Starbucks"
                />
                <Text className="text-[10px] text-slate-500 mt-1 italic dark:text-slate-400">
                  * App will learn this mapping for future syncs
                </Text>
              </View>

              <View className="mb-6">
                <Text className="text-slate-500 dark:text-slate-400 text-sm font-bold mb-2">Category</Text>
                {selectedDraft?.categoryHint && (
                  <View className="flex-row items-center mb-3 bg-indigo-50 dark:bg-indigo-900/20 px-3 py-2 rounded-xl border border-indigo-100 dark:border-indigo-900/40">
                    <FontAwesome name="magic" size={11} color="#6366f1" />
                    <Text className="text-indigo-600 dark:text-indigo-400 text-[11px] ml-2 font-semibold">
                      Parser detected: <Text className="font-bold">{selectedDraft.categoryHint}</Text>
                    </Text>
                  </View>
                )}
                <View className="bg-slate-50 dark:bg-slate-800 rounded-2xl p-4">
                  <Text className="text-[11px] text-slate-500 uppercase font-bold mb-3 dark:text-slate-400">
                    {selectedDraft?.type === 'INCOME' ? 'Income categories' : 'Expense categories'}
                  </Text>
                  <ScrollView showsVerticalScrollIndicator={false} className="max-h-64" nestedScrollEnabled>
                    {confirmRootCategories.map((category) => (
                      <View key={category.id} className="mb-3">
                        <TouchableOpacity
                          className={`w-full items-center p-4 rounded-2xl border-2 ${editedCategory === category.name ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-500' : 'bg-white dark:bg-slate-900 border-transparent' }`}
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
                            className={`w-full items-center p-3 rounded-xl ml-8 mt-2 border-2 ${editedCategory === childCategory.name ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-500' : 'bg-slate-100 dark:bg-slate-700 border-transparent' }`}
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

              {/* Tags Input */}
              <View className="mb-6">
                <Text className="text-slate-500 dark:text-slate-400 text-sm font-bold mb-2">Tags (Optional)</Text>
                <TextInput
                  value={tagsInput}
                  onChangeText={setTagsInput}
                  className="bg-slate-50 dark:bg-slate-800 p-4 rounded-xl text-slate-900 dark:text-white text-base border border-slate-100 dark:border-slate-700"
                  placeholder="e.g. travel, business"
                  placeholderTextColor="#94a3b8"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Text className="text-[10px] text-slate-500 mt-1 italic dark:text-slate-400">
                  Use comma-separated tags.
                </Text>
                {parseTagInput(tagsInput) && parseTagInput(tagsInput)!.length > 0 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-3 -mx-1 px-1">
                    {parseTagInput(tagsInput)!.map((tag) => (
                      <View key={tag} className="mr-2 px-3 py-1.5 rounded-full bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800">
                        <Text className="text-indigo-700 dark:text-indigo-300 text-xs font-semibold">#{tag}</Text>
                      </View>
                    ))}
                  </ScrollView>
                )}
                {uniqueTags.length > 0 && (
                  <View className="mt-3">
                    <Text className="text-[10px] text-slate-500 font-bold mb-1.5 uppercase dark:text-slate-400">Suggested / Used Tags</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-1 px-1">
                      {uniqueTags.map((tag) => {
                        const currentTags = parseTagInput(tagsInput) || [];
                        const isSelected = currentTags.some(t => t.toLowerCase() === tag.toLowerCase());
                        return (
                          <TouchableOpacity
                            key={tag}
                            onPress={() => handleToggleTag(tag)}
                            className={`mr-2 px-3 py-1 rounded-full border ${ isSelected ? 'bg-indigo-600 border-indigo-600' : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700' }`}
                          >
                            <Text
                              className={`text-xs font-medium ${ isSelected ? 'text-white' : 'text-slate-600 dark:text-slate-300' }`}
                            >
                              #{tag}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </View>
                )}
              </View>

              {/* Note Input */}
              <View className="mb-6">
                <Text className="text-slate-500 dark:text-slate-400 text-sm font-bold mb-2">Note (Optional)</Text>
                <TextInput
                  value={note}
                  onChangeText={setNote}
                  className="bg-slate-50 dark:bg-slate-800 p-4 rounded-xl text-slate-900 dark:text-white text-base border border-slate-100 dark:border-slate-700 min-h-[80px]"
                  placeholder="Add a note about this transaction..."
                  placeholderTextColor="#94a3b8"
                  multiline
                  textAlignVertical="top"
                />
              </View>

              {/* Technical Details */}
              <View className="bg-slate-50 dark:bg-slate-800 rounded-2xl p-4 mb-6">
                <View className="flex-row justify-between mb-2">
                  <Text className="text-slate-500 dark:text-slate-400 text-sm">Date</Text>
                  <Text className="text-slate-900 dark:text-white font-medium">
                    {formatDate(selectedDraft?.date || 0)} {formatTime(selectedDraft?.date || 0)}
                  </Text>
                </View>
                {selectedDraft?.fees && (
                  <View className="flex-row justify-between mb-2">
                    <Text className="text-slate-500 dark:text-slate-400 text-sm">Bank Fees</Text>
                    <Text className="text-slate-900 dark:text-white font-medium">{formatCurrency(selectedDraft.fees)}</Text>
                  </View>
                )}
                {selectedDraft?.tax && (
                  <View className="flex-row justify-between mb-2">
                    <Text className="text-slate-500 dark:text-slate-400 text-sm">Tax / VAT</Text>
                    <Text className="text-slate-900 dark:text-white font-medium">{formatCurrency(selectedDraft.tax)}</Text>
                  </View>
                )}
                {selectedDraft?.suggested_balance && (
                  <View className="flex-row justify-between mb-2">
                    <Text className="text-slate-500 dark:text-slate-400 text-sm">Expected Balance</Text>
                    <Text className="text-blue-600 dark:text-blue-400 font-bold">{formatCurrency(selectedDraft.suggested_balance)}</Text>
                  </View>
                )}
                {selectedDraft?.reference_number && (
                  <View className="flex-row justify-between mb-2">
                    <Text className="text-slate-500 dark:text-slate-400 text-sm">Reference</Text>
                    <Text className="text-slate-900 dark:text-white font-mono text-xs">{selectedDraft.reference_number}</Text>
                  </View>
                )}
                {selectedDraft?.receipt_url && (
                  <TouchableOpacity
                    onPress={() => Linking.openURL(selectedDraft.receipt_url!)}
                    className="flex-row items-center py-2"
                  >
                    <FontAwesome name="external-link" size={14} color="#6366f1" />
                    <Text className="text-indigo-600 dark:text-indigo-400 text-sm font-semibold ml-2">View Receipt / Download</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Original Message Ref */}
              <View className="mb-8">
                <Text className="text-slate-500 dark:text-slate-400 text-sm font-bold mb-2">Source Message</Text>
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
      </FormSheet>
    </View>
  );
}
