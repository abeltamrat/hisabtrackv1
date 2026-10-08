import { useAppSettings } from '@/contexts/AppSettingsContext';
import { useTransactions } from '@/context/TransactionContext';
import CategoryIcon from '@/components/CategoryIcon';
import ScreenInfoCard from '@/components/ScreenInfoCard';
import { BackgroundService } from '@/services/BackgroundService';
import { DraftTransaction, DraftTransactionService } from '@/services/DraftTransactionService';
import { SMSLearningService } from '@/services/SMSLearningService';
import { AppDispatch, RootState } from '@/store';
import { fetchAccounts, updateAccount } from '@/store/slices/accountsSlice';
import { addTransaction, deleteTransaction, fetchTransactions } from '@/store/slices/transactionsSlice';
import { addLoan, deleteLoan } from '@/store/slices/loansSlice';
import { FontAwesome } from '@expo/vector-icons';
import { SMSSyncService } from '@/services/SMSSyncService';
import { LinearGradient } from '@/components/aurora/AuroraGradient';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Modal, Platform, RefreshControl, ScrollView, SectionList, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Alert } from '@/utils/alert';
import FormSheet from '@/components/FormSheet';
import { useDispatch, useSelector } from 'react-redux';
import { parseTagInput } from '@/utils/tags';
import { RecurringTransactionService } from '@/services/RecurringTransactionService';
import type { RecurringFrequency, TransactionType } from '@/types/database';
import { findTransferCandidates } from '@/utils/transferPairing';
import TransactionSplitEditor from '@/components/TransactionSplitEditor';
import type { TransactionSplit } from '@/types/database';
import { money, sumMoney } from '@/utils/finance';
import { detectRecurringPattern } from '@/utils/recurringDetection';
import { useI18n } from '@/contexts/I18nContext';
import { rankTagSuggestions } from '@/utils/tagSuggestions';
import ReconciliationService, { type BalanceGapAnalysis } from '@/services/ReconciliationService';
import RecipientIdentityService from '@/services/RecipientIdentityService';
import SmsFundBlock from '@/components/funds/SmsFundBlock';
import { FUNDS_ENABLED } from '@/config/features';
import { useAuth } from '@/contexts/AuthContext';
import FundPostingService, { custodianTransactionId } from '@/services/FundPostingService';
import FundSyncService from '@/services/FundSyncService';
import { SharedFundService, type FundEntryInput } from '@/services/SharedFundService';
import type { FundEntry, SharedFund, Transaction } from '@/types/database';
import { custodianFundFields } from '@/utils/fundLedger';
import { generateUUID } from '@/utils/uuid';

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
  const { t } = useI18n();
  const router = useRouter();
  const dispatch = useDispatch<AppDispatch>();
  const params = useLocalSearchParams();
  const accountId = typeof params.accountId === 'string' ? params.accountId : undefined;
  const draftIdParam = typeof params.draftId === 'string' ? params.draftId : undefined;
  const evidenceIdsParam = typeof params.evidenceIds === 'string' ? params.evidenceIds : undefined;
  const shouldRecalibrate = params.recalibrate === '1';
  const communityGroupId = typeof params.communityGroupId === 'string' ? params.communityGroupId : undefined;
  const communityScheduleId = typeof params.communityScheduleId === 'string' ? params.communityScheduleId : undefined;
  const communityKind = params.communityKind === 'PAYOUT' ? 'PAYOUT' : params.communityKind === 'CONTRIBUTION' ? 'CONTRIBUTION' : undefined;
  const recalibrationStarted = useRef(false);

  const { formatCurrency } = useAppSettings();
  const { categories } = useTransactions();
  const { user } = useAuth();
  // Shared funds this user holds for someone else; an SMS can be recorded against one.
  const [fundSnapshot, setFundSnapshot] = useState(FundSyncService.getSnapshot());
  const [fundOn, setFundOn] = useState(false);
  const [fundId, setFundId] = useState('');
  const [fundSource, setFundSource] = useState<'owner' | 'third'>('owner');
  const [fundPayer, setFundPayer] = useState('');
  const [fundCategory, setFundCategory] = useState('');
  const [fundCandidates, setFundCandidates] = useState<FundEntry[]>([]);
  const [fundMatchEntryId, setFundMatchEntryId] = useState('');
  useEffect(() => (FUNDS_ENABLED ? FundSyncService.subscribe(setFundSnapshot) : undefined), []);
  const heldFunds = useMemo(
    () => fundSnapshot.funds.filter(item => !!user?.uid && item.custodianUid === user.uid && item.status === 'ACTIVE' && item.linkStatus === 'ACCEPTED'),
    [fundSnapshot.funds, user?.uid],
  );
  const { items: accounts } = useSelector((state: RootState) => state.accounts);
  const { items: transactions } = useSelector((state: RootState) => state.transactions);
  const account = accountId ? accounts.find(a => a.id === accountId) : undefined;

  const [drafts, setDrafts] = useState<DraftTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unrecorded' | 'recorded'>(evidenceIdsParam ? 'all' : 'unrecorded');

  // Preview & Confirm Modal States
  const [selectedDraft, setSelectedDraft] = useState<DraftTransaction | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Edit states for confirmation
  const [editedRecipient, setEditedRecipient] = useState('');
  const [editedDescription, setEditedDescription] = useState('');
  const [editedCategory, setEditedCategory] = useState('');
  const [editedType, setEditedType] = useState<TransactionType>('EXPENSE');
  const [transferSourceAccountId, setTransferSourceAccountId] = useState('');
  const [transferDestinationAccountId, setTransferDestinationAccountId] = useState('');
  const [matchedCounterpartId, setMatchedCounterpartId] = useState('');
  const [rememberOwnedRecipient, setRememberOwnedRecipient] = useState(false);
  const [makeRecurring, setMakeRecurring] = useState(false);
  const [recurringFrequency, setRecurringFrequency] = useState<RecurringFrequency>('MONTHLY');
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [reminderDaysBefore, setReminderDaysBefore] = useState('1');
  const [reminderTime, setReminderTime] = useState('09:00');
  const [recurringNextDate, setRecurringNextDate] = useState('');
  const [recurringEndDate, setRecurringEndDate] = useState('');
  const [recurringOccurrences, setRecurringOccurrences] = useState('');
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [splits, setSplits] = useState<TransactionSplit[]>([]);
  const [dismissedRecurringSuggestion, setDismissedRecurringSuggestion] = useState(false);
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

  const uniqueTags = useMemo(() => rankTagSuggestions(transactions, {
    category: editedCategory,
    recipient: editedRecipient,
    timestamp: selectedDraft?.date,
  }), [editedCategory, editedRecipient, selectedDraft?.date, transactions]);
  const tagsForCategory = (category: string) => rankTagSuggestions(transactions, {
    category,
    recipient: editedRecipient,
    timestamp: selectedDraft?.date,
  });
  const recurringSuggestion = useMemo(() => selectedDraft ? detectRecurringPattern({
    type: editedType,
    amount: selectedDraft.amount,
    category: editedCategory,
    sender_receiver: editedRecipient,
    description: editedDescription,
    date: selectedDraft.date,
  } as any, transactions) : null, [editedCategory, editedDescription, editedRecipient, editedType, selectedDraft, transactions]);

  const filteredDrafts = useMemo(() => {
    const evidenceIds = new Set((evidenceIdsParam || '').split(',').filter(Boolean));
    return drafts.filter(d => {
      if (evidenceIds.size && !evidenceIds.has(d.id)) return false;
      if (typeFilter === 'income') return d.type === 'INCOME';
      if (typeFilter === 'expense') return d.type === 'EXPENSE';
      return true;
    });
  }, [drafts, evidenceIdsParam, typeFilter]);

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
      setEditedRecipient(target.sender_receiver || '');
      setEditedDescription(target.description);
      setEditedCategory(target.category);
      setEditedType(target.is_transfer ? 'TRANSFER' : target.type);
      setTransferSourceAccountId(target.transfer_from_account_id || target.account_id);
      setTransferDestinationAccountId(target.transfer_to_account_id || (target.type === 'INCOME' ? target.account_id : ''));
      setMatchedCounterpartId(target.paired_draft_id || '');
      setRememberOwnedRecipient(false);
      setSplitEnabled(!!target.suggested_splits?.length);
      setSplits(target.suggested_splits || []);
      setDismissedRecurringSuggestion(false);
      setNote('');
      setTagsInput('');
      void applyRecipientDefaults(target);
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

  const handleBalanceAdjustment = (draft: DraftTransaction, analysis: BalanceGapAnalysis) => {
    const adjustmentType = analysis.gap > 0 ? 'INCOME' : 'EXPENSE';
    const amount = Math.abs(analysis.gap);
    Alert.alert(
      'Review balance adjustment',
      `Record a ${formatCurrency(amount)} ${adjustmentType.toLowerCase()} adjustment on ${new Date(draft.date).toLocaleDateString()}? This only explains the balance gap; it does not guess a recipient or spending category.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Record adjustment',
          onPress: async () => {
            const result = await dispatch(addTransaction({
              account_id: draft.account_id,
              amount,
              type: adjustmentType,
              category: 'Balance Adjustment',
              purpose: 'ADJUSTMENT',
              description: `Balance adjustment supported by bank SMS dated ${new Date(draft.date).toLocaleString()}`,
              date: draft.date,
              reference_number: draft.reference_number,
              receipt_url: draft.receipt_url,
              operation_id: `balance-gap:${draft.id}:${analysis.bankBalance}`,
            }));
            if (addTransaction.rejected.match(result)) {
              Alert.alert('Could not record adjustment', result.error.message || 'Please try again.');
              return;
            }
            Alert.alert('Balance adjusted', 'The adjustment was recorded separately and can be undone.', [
              { text: 'Done' },
              { text: 'Undo', onPress: () => { void dispatch(deleteTransaction(result.payload.id)); } },
            ]);
          },
        },
      ]
    );
  };

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

  const applyRecipientDefaults = async (draft: DraftTransaction) => {
    const profile = await RecipientIdentityService.resolve(draft.sender_receiver, draft.raw_sms);
    if (!profile) return;
    const defaults = RecipientIdentityService.learnedDefaults(profile, transactions);
    setEditedRecipient(profile.displayName);
    if (defaults.category && !draft.is_transfer) setEditedCategory(defaults.category);
    if (defaults.tags.length) setTagsInput(defaults.tags.join(', '));
  };

  const openConfirmModal = (draft: DraftTransaction) => {
    setSelectedDraft(draft);
    setEditedRecipient(draft.sender_receiver || '');
    setEditedDescription(draft.description);
    setEditedCategory(draft.category);
    setEditedType(draft.is_transfer ? 'TRANSFER' : draft.type);
    setTransferSourceAccountId(draft.transfer_from_account_id || draft.account_id);
    setTransferDestinationAccountId(draft.transfer_to_account_id || (draft.type === 'INCOME' ? draft.account_id : ''));
    setMatchedCounterpartId(draft.paired_draft_id || '');
    setRememberOwnedRecipient(false);
    setMakeRecurring(false);
    setRecurringFrequency('MONTHLY');
    setReminderEnabled(true);
    setReminderDaysBefore('1');
    setReminderTime('09:00');
    setRecurringNextDate('');
    setRecurringEndDate('');
    setRecurringOccurrences('');
    setSplitEnabled(!!draft.suggested_splits?.length);
    setSplits(draft.suggested_splits || []);
    setDismissedRecurringSuggestion(false);
    setNote('');
    setTagsInput('');
    void applyRecipientDefaults(draft);
    setRecordAsLoan(!!draft.is_loan_disbursement);
    setFundOn(false);
    setFundId('');
    setFundSource('owner');
    setFundPayer(draft.sender_receiver || '');
    setFundCategory('');
    setFundCandidates([]);
    setFundMatchEntryId('');
    setLoanCounterparty(draft.sender_receiver || 'SMS loan');
    const defaultDue = new Date(draft.date + 30 * 24 * 60 * 60 * 1000);
    setLoanDueDate(defaultDue.toISOString().slice(0, 10));
    setShowConfirmModal(true);
  };

  // A credit SMS may be money the owner already told us to expect.
  useEffect(() => {
    if (!FUNDS_ENABLED || !fundOn || !fundId || editedType !== 'INCOME' || !selectedDraft) { setFundCandidates([]); return; }
    let cancelled = false;
    const amount = Math.round(selectedDraft.amount * 100);
    SharedFundService.getAllEntries(fundId).then(entries => {
      if (cancelled) return;
      const open = entries.filter(item => item.kind === 'DEPOSIT' && item.recordedByRole === 'OWNER' && !item.ackAt && item.status !== 'VOIDED' && Math.round(item.amount * 100) === amount);
      setFundCandidates(open);
      setFundMatchEntryId(open[0]?.id ?? '');
    }).catch(() => { if (!cancelled) setFundCandidates([]); });
    return () => { cancelled = true; };
  }, [fundOn, fundId, editedType, selectedDraft]);

  /**
   * Records the confirmed SMS against a fund this user holds. The custodian's
   * own ledger row is written first (offline-safe); the fund hears about it
   * through FundPostingService. Fees the bank took count toward the payment.
   */
  const postFundEntry = async (fund: SharedFund, input: Omit<Transaction, 'id'>, description: string, tags?: string[]) => {
    const draft = selectedDraft!;
    const isSpend = editedType === 'EXPENSE';
    const match = !isSpend && fundMatchEntryId ? fundCandidates.find(item => item.id === fundMatchEntryId) : undefined;
    const entryId = match?.id ?? generateUUID();
    const httpsReceipt = input.receipt_url && /^https:\/\//i.test(input.receipt_url) ? input.receipt_url : undefined;
    const fee = isSpend ? Math.max(0, money((draft.gross_amount ?? draft.amount + (draft.fees ?? 0) + (draft.tax ?? 0)) - draft.amount)) : 0;
    const category = isSpend ? fundCategory || input.category : 'Fund deposit';
    const local = { ...input, category, ...custodianFundFields(fund.id, entryId) } as Omit<Transaction, 'id'>;
    const evidence = { reference_number: draft.reference_number, receipt_url: httpsReceipt, sms_linked: true };
    let entry: FundEntryInput | undefined;
    if (!match && isSpend) {
      const parts = input.splits?.length ? [...input.splits, ...(fee > 0 ? [{ id: 'bank-fees', amount: fee, category: 'Bank Fees' }] : [])] : undefined;
      entry = { kind: 'SPEND', amount: money(draft.amount + fee), date: draft.date, description, recipient: input.sender_receiver, category, splits: parts, tags, ...evidence };
    } else if (!match) {
      entry = {
        kind: 'DEPOSIT', source: fundSource === 'third' ? 'THIRD_PARTY' : 'OWNER_UNRECORDED',
        payerName: fundSource === 'third' ? fundPayer.trim() || input.sender_receiver || 'Someone' : undefined,
        amount: draft.amount, date: draft.date, description, tags, ...evidence,
      };
    }
    const kind: 'record' | 'ack' = match ? 'ack' : 'record';
    const result = await FundPostingService.submit(
      { id: entryId, uid: user!.uid, fundId: fund.id, fundName: fund.name, kind, entry, evidence: match ? evidence : undefined },
      () => dispatch(addTransaction(local)).unwrap(),
    );
    return {
      transactionId: custodianTransactionId(entryId),
      entryId,
      kind,
      message: result.synced ? `${fund.ownerName} can see it now.` : result.error ? `The fund refused it: ${result.error}` : `It will be shared with ${fund.ownerName} when you are online.`,
    };
  };

  const handleRecordConfirmed = async () => {
    if (!selectedDraft) return;

    setIsRecording(true);
    try {
      // 1. Learn / reinforce rules
      const hasCorrections =
        editedDescription !== selectedDraft.description ||
        editedCategory !== selectedDraft.category ||
        editedType !== selectedDraft.type;
      const learnedSender = selectedDraft.sms_sender || account?.sms_number?.split(',')[0] || '';

      if (learnedSender && (selectedDraft.sender_receiver || selectedDraft.reference_number)) {
        await SMSLearningService.learn({
          accountId: selectedDraft.account_id,
          sender: learnedSender,
          rawMerchant: selectedDraft.sender_receiver,
          referenceNumber: selectedDraft.reference_number,
          correctedDescription: editedDescription,
          correctedCategory: editedType === 'TRANSFER' ? 'Transfer' : editedCategory,
          isCorrection: hasCorrections,
          transactionType: editedType === 'TRANSFER' ? selectedDraft.type : editedType,
          splits: editedType !== 'TRANSFER' && splitEnabled ? splits : undefined,
          transferFromAccountId: editedType === 'TRANSFER' ? transferSourceAccountId : undefined,
          transferToAccountId: editedType === 'TRANSFER' ? transferDestinationAccountId : undefined,
        });
      }

      // 2. Create transaction
      const finalDescription = note.trim()
        ? `${editedDescription.trim()} (${note.trim()})`
        : editedDescription.trim();

      const parsedTags = parseTagInput(tagsInput);
      if (editedType !== 'TRANSFER' && splitEnabled && (splits.length < 2 || splits.some(item => !item.category.trim() || money(item.amount) <= 0) || sumMoney(splits.map(item => item.amount)) !== money(selectedDraft.amount))) {
        Alert.alert('Check split amounts', `Use at least two positive parts that add up to ${formatCurrency(selectedDraft.amount)}.`);
        return;
      }

      // Outgoing leg knows its destination; incoming leg knows its source —
      // either one records as a single TRANSFER from source to destination.
      const isTransferDraft = editedType === 'TRANSFER';
      if (isTransferDraft && (!transferSourceAccountId || !transferDestinationAccountId || transferSourceAccountId === transferDestinationAccountId)) {
        Alert.alert('Choose transfer accounts', 'Select two different owned accounts for this transfer.');
        return;
      }
      const counterpart = matchedCounterpartId ? drafts.find(d => d.id === matchedCounterpartId) : undefined;
      const expenseLeg = selectedDraft.type === 'EXPENSE' ? selectedDraft : counterpart?.type === 'EXPENSE' ? counterpart : selectedDraft;
      const transferAmount = expenseLeg.gross_amount
        ?? Math.round((expenseLeg.amount + (expenseLeg.fees ?? 0) + (expenseLeg.tax ?? 0)) * 100) / 100;
      if (isTransferDraft && rememberOwnedRecipient && editedRecipient.trim()) {
        const ownedAccountId = selectedDraft.type === 'EXPENSE' ? transferDestinationAccountId : transferSourceAccountId;
        const ownedAccount = accounts.find(item => item.id === ownedAccountId);
        const alias = editedRecipient.trim();
        if (ownedAccount && !ownedAccount.aliases?.some(item => item.toLocaleLowerCase() === alias.toLocaleLowerCase())) {
          await dispatch(updateAccount({ ...ownedAccount, aliases: [...(ownedAccount.aliases || []), alias] })).unwrap();
        }
      }
      const transactionInput = {
        account_id: isTransferDraft ? transferSourceAccountId : selectedDraft.account_id,
        type: isTransferDraft ? 'TRANSFER' : editedType,
        ...(isTransferDraft ? { to_account_id: transferDestinationAccountId } : {}),
        // The incoming leg carries the net received; TRANSFER stores the gross
        // source debit and the DB nets fees/tax off the destination credit.
        amount: isTransferDraft ? transferAmount : selectedDraft.amount,
        category: isTransferDraft ? 'Transfer' : editedCategory,
        description: finalDescription,
        tags: parsedTags,
        date: selectedDraft.date,
        sender_receiver: editedRecipient.trim() || undefined,
        reference_number: selectedDraft.reference_number,
        sms_id: selectedDraft.sms_id,
        fees: expenseLeg.fees,
        tax: expenseLeg.tax,
        gross_amount: isTransferDraft ? undefined : selectedDraft.gross_amount,
        service_charge: expenseLeg.service_charge,
        vat: expenseLeg.vat,
        disaster_recovery_fee: expenseLeg.disaster_recovery_fee,
        receipt_url: expenseLeg.receipt_url || selectedDraft.receipt_url,
        ...(editedType !== 'TRANSFER' && splitEnabled ? { splits } : {}),
      } as Omit<Transaction, 'id'>;

      let transactionId: string | undefined;
      let fundUndo: { fundId: string; entryId: string; kind: 'record' | 'ack' } | undefined;
      let fundMessage = '';
      const fundForEntry = FUNDS_ENABLED && fundOn && !isTransferDraft ? heldFunds.find(item => item.id === fundId) : undefined;
      if (fundForEntry) {
        const posted = await postFundEntry(fundForEntry, transactionInput, finalDescription, parsedTags);
        transactionId = posted.transactionId;
        fundUndo = { fundId: fundForEntry.id, entryId: posted.entryId, kind: posted.kind };
        fundMessage = posted.message;
      } else {
        const result = await dispatch(addTransaction(transactionInput));
        if (addTransaction.rejected.match(result)) {
          Alert.alert('Error', 'Failed to record transaction. Please try again.');
          return;
        }
        transactionId = (result.payload as any)?.id;
      }

      await dispatch(fetchAccounts());
      const counterpartId = matchedCounterpartId || selectedDraft.paired_draft_id;
      if (transactionId) {
        const confirmation: NonNullable<DraftTransaction['confirmation']> = {
          recorded_at: Date.now(),
          type: isTransferDraft ? 'TRANSFER' : editedType,
          category: isTransferDraft ? 'Transfer' : editedCategory,
          description: finalDescription,
          recipient: editedRecipient.trim() || undefined,
          source_account_id: isTransferDraft ? transferSourceAccountId : selectedDraft.account_id,
          destination_account_id: isTransferDraft ? transferDestinationAccountId : undefined,
          counterpart_draft_id: counterpartId || undefined,
        };
        await DraftTransactionService.markAsRecorded(selectedDraft.id, transactionId, confirmation);
        if (communityGroupId && communityKind) {
          await (await import('@/services/CommunityGroupService')).CommunityGroupService.linkRecordedSms(communityGroupId, communityScheduleId, selectedDraft.id, communityKind);
        }
        // The opposite leg of a paired self-transfer is covered by the same
        // TRANSFER transaction — close it too so it can't be double-recorded.
        if (counterpartId) {
          await DraftTransactionService.markAsRecorded(counterpartId, transactionId, confirmation);
        }
      }

      let recurringError = '';
      let recurringRuleId: string | undefined;
      if (makeRecurring && !fundUndo) {
        try {
          const match = /^(\d{1,2}):(\d{2})$/.exec(reminderTime.trim());
          const hour = match ? Number(match[1]) : -1;
          const minute = match ? Number(match[2]) : -1;
          if (reminderEnabled && (hour < 0 || hour > 23 || minute < 0 || minute > 59)) throw new Error('Reminder time must use HH:MM');
          const recurringRule = await RecurringTransactionService.create({
            name: finalDescription || editedRecipient || 'SMS transaction',
            amount: isTransferDraft ? transferAmount : selectedDraft.amount,
            type: isTransferDraft ? 'TRANSFER' : editedType,
            category: isTransferDraft ? 'Transfer' : editedCategory,
            accountId: isTransferDraft ? transferSourceAccountId : selectedDraft.account_id,
            toAccountId: isTransferDraft ? transferDestinationAccountId : undefined,
            fees: isTransferDraft ? expenseLeg.fees : undefined,
            tax: isTransferDraft ? expenseLeg.tax : undefined,
            description: finalDescription,
            tags: parsedTags,
            frequency: recurringFrequency,
            startDate: selectedDraft.date,
            reminderEnabled,
            reminderDaysBefore: Number(reminderDaysBefore) || 0,
            reminderDaysBeforeList: reminderDaysBefore.split(',').map(value => Number(value.trim())).filter(Number.isFinite),
            reminderHour: Math.max(0, hour),
            reminderMinute: Math.max(0, minute),
            splits: splitEnabled ? splits : undefined,
            nextDate: recurringNextDate ? new Date(`${recurringNextDate}T12:00:00`).getTime() : undefined,
            endDate: recurringEndDate ? new Date(`${recurringEndDate}T23:59:59`).getTime() : undefined,
            totalRepetitions: recurringOccurrences ? Number(recurringOccurrences) : undefined,
          });
          recurringRuleId = recurringRule.id;
        } catch (error: any) {
          recurringError = error?.message || 'Recurring rule could not be created.';
        }
      }

      // Loan creation tracks the liability/receivable only; it does not mutate
      // the account balance, which was already updated by the cash transaction.
      let loanCreated = false;
      let loanId: string | undefined;
      if (recordAsLoan && editedType !== 'TRANSFER' && !fundUndo) {
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
        if (loanCreated) loanId = (loanResult.payload as any)?.id;
      }
      await BackgroundService.markReconciliationReview();
      setShowConfirmModal(false);
      await loadDrafts();
      const successMessage = fundUndo
          ? `Recorded for ${fundForEntry?.name}. ${fundMessage}`
          : recordAsLoan
          ? loanCreated
            ? `Transaction recorded and ${selectedDraft.type === 'INCOME' ? 'borrowed loan' : 'loan given'} added to Loans.`
            : 'Transaction recorded, but the loan record could not be created. You can add it manually from Loans.'
          : recurringError
            ? `Transaction recorded. Recurring setup needs attention: ${recurringError}`
            : makeRecurring ? 'Transaction and recurring rule recorded!' : 'Transaction recorded!';
      if (transactionId) {
        Alert.alert('Transaction recorded', successMessage, [
          { text: 'Keep', style: 'cancel' },
          { text: 'Undo', style: 'destructive', onPress: async () => {
            try {
              if (recurringRuleId) await RecurringTransactionService.remove(recurringRuleId);
              if (loanId) await dispatch(deleteLoan(loanId)).unwrap();
              // Fund rows are guarded in the ledger; they are taken back through the fund.
              if (fundUndo) await FundPostingService.undo(fundUndo.fundId, fundUndo.entryId, fundUndo.kind);
              else await dispatch(deleteTransaction(transactionId)).unwrap();
              await DraftTransactionService.reopenRecorded([selectedDraft.id, ...(counterpartId ? [counterpartId] : [])], transactionId);
              await dispatch(fetchAccounts());
              await dispatch(fetchTransactions());
              await loadDrafts();
            } catch {
              Alert.alert('Undo failed', 'The transaction could not be reversed.');
            }
          } },
        ], { cancelable: false });
      } else {
        Alert.alert('Success', successMessage);
      }
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
          gross_amount: draft.gross_amount,
          service_charge: draft.service_charge,
          vat: draft.vat,
          disaster_recovery_fee: draft.disaster_recovery_fee,
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
              transactionType: draft.type,
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
  const transferCandidates = selectedDraft ? findTransferCandidates(selectedDraft, drafts) : [];
  const confirmCategoryType = editedType === 'INCOME' ? 'income' : 'expense';
  const confirmCategories = categories.filter((category) => category.type === confirmCategoryType);
  const getConfirmChildCategories = (parentId: string | undefined) =>
    confirmCategories.filter((category) => (category.parentId ?? undefined) === parentId);

  const renderConfirmCategoryTree = (parentId: string | undefined, depth: number): React.ReactNode =>
    // depth guard keeps a malformed parentId cycle from recursing forever
    depth > 12 ? null : getConfirmChildCategories(parentId).map((category) => {
      const isRoot = depth === 0;
      const isSelected = editedCategory === category.name;

      return (
        <View key={category.id} className={isRoot ? 'mb-3' : 'mt-2'}>
          <TouchableOpacity
            className={`w-full items-center border-2 ${isRoot ? 'p-4 rounded-2xl' : 'p-3 rounded-xl'} ${isSelected ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-500' : isRoot ? 'bg-white dark:bg-slate-900 border-transparent' : 'bg-slate-100 dark:bg-slate-700 border-transparent' }`}
            style={{ marginLeft: Math.min(depth, 5) * 16 }}
            onPress={() => setEditedCategory(category.name)}
          >
            <View className="flex-row items-center w-full">
              {!isRoot && <View className="w-1 h-4 bg-slate-300 dark:bg-slate-600 mr-2 rounded-full" />}
              <View
                className={`justify-center items-center mr-3 ${isRoot ? 'rounded-2xl' : 'rounded-xl'}`}
                style={{ width: isRoot ? 40 : 32, height: isRoot ? 40 : 32, backgroundColor: category.color + '20' }}
              >
                <CategoryIcon icon={category.icon} size={isRoot ? 18 : 14} color={category.color} />
              </View>
              <View className="flex-1">
                <Text
                  className={isRoot
                    ? 'text-slate-900 dark:text-white text-sm font-semibold text-left'
                    : 'text-slate-700 dark:text-slate-300 text-xs font-medium text-left'}
                  numberOfLines={2}
                >
                  {category.name}
                </Text>
              </View>
              {isSelected && <FontAwesome name="check" size={isRoot ? 16 : 12} color="#6366f1" />}
            </View>
          </TouchableOpacity>
          {renderConfirmCategoryTree(category.id, depth + 1)}
        </View>
      );
    });

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
            const wasCorrected = !!draft.confirmation && (
              draft.confirmation.type !== (draft.is_transfer ? 'TRANSFER' : draft.type)
              || draft.confirmation.category !== draft.category
              || draft.confirmation.description !== draft.description
              || (draft.confirmation.recipient || '') !== (draft.sender_receiver || '')
            );

            const draftAccount = accounts.find((a: any) => a.id === draft.account_id);
            const balanceAnalysis = draftAccount
              ? ReconciliationService.analyzeDraft(draftAccount, draft, transactions, drafts)
              : null;
            const hasDiscrepancy = !!balanceAnalysis?.hasDiscrepancy;
            const hasPendingExplanation = balanceAnalysis?.reason === 'UNRECORDED_DRAFT';

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
                    {isRecorded && draft.confirmation && (
                      <View className="px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-700"><Text className="text-[10px] font-bold text-slate-600 dark:text-slate-300">Reviewed {new Date(draft.confirmation.recorded_at).toLocaleDateString()}</Text></View>
                    )}
                    {wasCorrected && <View className="px-2 py-1 rounded-full bg-violet-100 dark:bg-violet-900/30"><Text className="text-[10px] font-bold text-violet-700 dark:text-violet-300">Corrected</Text></View>}
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
                  <View className="bg-red-50 dark:bg-red-950/20 p-2.5 rounded-xl mb-3 border border-red-100 dark:border-red-900/30">
                    <View className="flex-row items-center">
                      <FontAwesome name="exclamation-triangle" size={12} color="#ef4444" />
                      <Text className="text-red-600 dark:text-red-400 text-[10px] ml-2 font-semibold flex-1">
                        Balance gap {formatCurrency(Math.abs(balanceAnalysis?.gap || 0))}: bank states {formatCurrency(balanceAnalysis?.bankBalance || 0)}, while the historical ledger reconstructs {formatCurrency(balanceAnalysis?.expectedBalance || 0)}. {balanceAnalysis?.explanation}
                      </Text>
                    </View>
                    {balanceAnalysis && (balanceAnalysis.evidence.transactions.length > 0 || balanceAnalysis.evidence.previousAnchor) && (
                      <View className="mt-2 border-t border-red-200 dark:border-red-900/40 pt-2">
                        {balanceAnalysis.evidence.previousAnchor && <Text className="text-red-600/80 dark:text-red-300/80 text-[10px]">Previous bank balance: {formatCurrency(balanceAnalysis.evidence.previousAnchor.suggested_balance || 0)} on {formatDate(balanceAnalysis.evidence.previousAnchor.date)}</Text>}
                        {balanceAnalysis.evidence.transactions.slice(0, 3).map(transaction => <Text key={transaction.id} className="text-red-600/80 dark:text-red-300/80 text-[10px] mt-1">• {formatDate(transaction.date)} · {transaction.description} · {formatCurrency(transaction.gross_amount ?? transaction.amount)}</Text>)}
                      </View>
                    )}
                    {balanceAnalysis && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Review balance adjustment" onPress={() => handleBalanceAdjustment(draft, balanceAnalysis)} className="self-start mt-2 px-3 py-2 rounded-lg bg-red-600">
                      <Text className="text-white text-[10px] font-bold">Review adjustment</Text>
                    </TouchableOpacity>}
                  </View>
                )}

                {hasPendingExplanation && balanceAnalysis?.suggestedDraft && (
                  <View className="bg-indigo-50 dark:bg-indigo-950/20 p-3 rounded-xl mb-3 border border-indigo-200 dark:border-indigo-900/40">
                    <Text className="text-indigo-700 dark:text-indigo-300 text-xs font-semibold">{balanceAnalysis.explanation}</Text>
                    {balanceAnalysis.suggestedDraft.id !== draft.id && <TouchableOpacity onPress={() => openConfirmModal(balanceAnalysis.suggestedDraft!)} className="self-start mt-2 px-3 py-2 rounded-lg bg-indigo-600"><Text className="text-white text-[10px] font-bold">Review matching draft</Text></TouchableOpacity>}
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
                  <Text className={`font-bold text-lg ${editedType === 'INCOME' ? 'text-green-600' : editedType === 'TRANSFER' ? 'text-indigo-600' : 'text-red-500'}`}>
                    {editedType}
                  </Text>
                </View>
                <View className="flex-1 bg-slate-50 dark:bg-slate-800 p-4 rounded-2xl">
                  <Text className="text-slate-500 dark:text-slate-400 text-xs mb-1 uppercase font-bold">Amount</Text>
                  <Text adjustsFontSizeToFit numberOfLines={1} minimumFontScale={0.6} className="text-slate-900 dark:text-white font-bold text-lg">
                    {formatCurrency(selectedDraft?.amount || 0)}
                  </Text>
                </View>
              </View>

              <View className="bg-slate-50 dark:bg-slate-800 rounded-2xl p-4 mb-5">
                <Text className="text-slate-500 dark:text-slate-400 text-xs font-bold mb-2 uppercase">Record as</Text>
                <View className="flex-row gap-2">
                  {(['EXPENSE', 'INCOME', 'TRANSFER'] as TransactionType[]).map(item => (
                    <TouchableOpacity key={item} onPress={() => { setEditedType(item); setRecordAsLoan(false); }} className={`flex-1 py-2.5 rounded-xl items-center ${editedType === item ? 'bg-indigo-600' : 'bg-white dark:bg-slate-900'}`}>
                      <Text className={`text-[10px] font-bold ${editedType === item ? 'text-white' : 'text-slate-600 dark:text-slate-300'}`}>{item}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {editedType === 'TRANSFER' && (
                <View className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-2xl p-4 mb-5">
                  <Text className="text-indigo-900 dark:text-indigo-200 font-bold mb-1">Bank-to-bank transfer</Text>
                  <Text className="text-indigo-700 dark:text-indigo-300 text-xs mb-3">Choose the owned source and destination accounts. A matched opposite SMS will be closed with this transaction.</Text>
                  {transferCandidates.length > 0 && (
                    <View className="mb-3">
                      <Text className="text-indigo-700 dark:text-indigo-300 text-[10px] font-bold uppercase mb-2">Possible counterpart SMS</Text>
                      {transferCandidates.slice(0, 3).map(candidate => {
                        const counterpartId = candidate.expenseId === selectedDraft?.id ? candidate.incomeId : candidate.expenseId;
                        const counterpart = drafts.find(item => item.id === counterpartId);
                        const counterpartAccount = accounts.find(item => item.id === counterpart?.account_id);
                        return (
                          <TouchableOpacity key={counterpartId} onPress={() => {
                            setMatchedCounterpartId(counterpartId);
                            setTransferSourceAccountId(candidate.expenseAccountId);
                            setTransferDestinationAccountId(candidate.incomeAccountId);
                          }} className={`p-3 rounded-xl mb-2 border ${matchedCounterpartId === counterpartId ? 'bg-indigo-600 border-indigo-600' : 'bg-white dark:bg-slate-900 border-indigo-200 dark:border-indigo-800'}`}>
                            <Text className={`text-xs font-bold ${matchedCounterpartId === counterpartId ? 'text-white' : 'text-slate-900 dark:text-white'}`}>{counterpartAccount?.name || 'Other account'} · {formatCurrency(counterpart?.amount || 0)}</Text>
                            <Text className={`text-[10px] mt-1 ${matchedCounterpartId === counterpartId ? 'text-indigo-100' : 'text-slate-500 dark:text-slate-400'}`}>{candidate.confidence === 'HIGH' ? 'Strong match' : 'Possible match'} · {candidate.score}% · {formatDate(counterpart?.date || 0)} {formatTime(counterpart?.date || 0)}</Text>
                            <Text className={`text-[10px] mt-1 ${matchedCounterpartId === counterpartId ? 'text-indigo-100' : 'text-slate-500 dark:text-slate-400'}`}>{candidate.reasons.join(' · ')}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                  <Text className="text-slate-600 dark:text-slate-300 text-[10px] font-bold mb-1">From account</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-3">
                    {accounts.map(item => <TouchableOpacity key={item.id} onPress={() => setTransferSourceAccountId(item.id)} className={`mr-2 px-3 py-2 rounded-xl ${transferSourceAccountId === item.id ? 'bg-indigo-600' : 'bg-white dark:bg-slate-900'}`}><Text className={`text-xs font-semibold ${transferSourceAccountId === item.id ? 'text-white' : 'text-slate-700 dark:text-slate-300'}`}>{item.name}</Text></TouchableOpacity>)}
                  </ScrollView>
                  <Text className="text-slate-600 dark:text-slate-300 text-[10px] font-bold mb-1">To account</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {accounts.filter(item => item.id !== transferSourceAccountId).map(item => <TouchableOpacity key={item.id} onPress={() => setTransferDestinationAccountId(item.id)} className={`mr-2 px-3 py-2 rounded-xl ${transferDestinationAccountId === item.id ? 'bg-indigo-600' : 'bg-white dark:bg-slate-900'}`}><Text className={`text-xs font-semibold ${transferDestinationAccountId === item.id ? 'text-white' : 'text-slate-700 dark:text-slate-300'}`}>{item.name}</Text></TouchableOpacity>)}
                  </ScrollView>
                  {!!editedRecipient.trim() && <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: rememberOwnedRecipient }} onPress={() => setRememberOwnedRecipient(!rememberOwnedRecipient)} className="flex-row items-center mt-4">
                    <FontAwesome name={rememberOwnedRecipient ? 'check-square' : 'square-o'} size={18} color={rememberOwnedRecipient ? '#6366f1' : '#94a3b8'} />
                    <View className="ml-2 flex-1"><Text className="text-slate-800 dark:text-slate-200 text-xs font-bold">{t('rememberOwnedAccount')}</Text><Text className="text-slate-500 dark:text-slate-400 text-[10px] mt-0.5">Future SMS using “{editedRecipient.trim()}” can identify the owned account automatically.</Text></View>
                  </TouchableOpacity>}
                </View>
              )}

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

              {FUNDS_ENABLED && editedType !== 'TRANSFER' && heldFunds.length > 0 && (
                <SmsFundBlock
                  funds={heldFunds}
                  isSpend={editedType === 'EXPENSE'}
                  on={fundOn}
                  fundId={fundId}
                  source={fundSource}
                  payer={fundPayer}
                  category={fundCategory}
                  candidates={fundCandidates}
                  matchId={fundMatchEntryId}
                  formatCurrency={formatCurrency}
                  onToggle={() => {
                    const next = !fundOn;
                    setFundOn(next);
                    if (next) { setRecordAsLoan(false); setMakeRecurring(false); }
                    if (next && !fundId) setFundId(heldFunds[0].id);
                  }}
                  onFund={setFundId}
                  onSource={setFundSource}
                  onPayer={setFundPayer}
                  onCategory={setFundCategory}
                  onMatch={setFundMatchEntryId}
                />
              )}

              {editedType !== 'TRANSFER' && !fundOn && (
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
                <Text className="text-slate-500 dark:text-slate-400 text-sm font-bold mb-2">{t('recipient')}</Text>
                <TextInput
                  value={editedRecipient}
                  onChangeText={setEditedRecipient}
                  className="bg-slate-50 dark:bg-slate-800 p-4 rounded-xl text-slate-900 dark:text-white text-base border border-slate-100 dark:border-slate-700"
                  placeholder="Who received or sent the money?"
                  placeholderTextColor="#94a3b8"
                />
              </View>

              <View className="mb-6">
                <Text className="text-slate-500 dark:text-slate-400 text-sm font-bold mb-2">Description / reason</Text>
                <TextInput
                  value={editedDescription}
                  onChangeText={setEditedDescription}
                  className="bg-slate-50 dark:bg-slate-800 p-4 rounded-xl text-slate-900 dark:text-white text-base border border-slate-100 dark:border-slate-700"
                  placeholder="What was this expense for?"
                  placeholderTextColor="#94a3b8"
                />
                <Text className="text-[10px] text-slate-500 mt-1 italic dark:text-slate-400">
                  * App will learn this mapping for future syncs
                </Text>
              </View>

              {editedType !== 'TRANSFER' && <View className="mb-6">
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
                    {editedType === 'INCOME' ? 'Income categories' : 'Expense categories'}
                  </Text>
                  <ScrollView showsVerticalScrollIndicator={false} className="max-h-64" nestedScrollEnabled>
                    {renderConfirmCategoryTree(undefined, 0)}
                  </ScrollView>
                </View>
              </View>}

              {editedType !== 'TRANSFER' && (
                <View className="mb-6">
                  <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: splitEnabled }} onPress={() => {
                    const enabled = !splitEnabled;
                    setSplitEnabled(enabled);
                    if (enabled && splits.length === 0) setSplits([
                      { id: `split-${Date.now()}-0`, amount: selectedDraft?.amount || 0, category: editedCategory || confirmCategories[0]?.name || 'Uncategorized' },
                      { id: `split-${Date.now()}-1`, amount: 0, category: confirmCategories[1]?.name || confirmCategories[0]?.name || 'Uncategorized' },
                    ]);
                  }} className="flex-row items-center rounded-2xl p-4 mb-3 bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700">
                    <FontAwesome name={splitEnabled ? 'check-square' : 'square-o'} size={18} color={splitEnabled ? '#6366f1' : '#94a3b8'} />
                    <View className="ml-3 flex-1"><Text className="text-slate-900 dark:text-white font-bold">Split across categories</Text><Text className="text-slate-500 dark:text-slate-400 text-xs mt-0.5">Keep one bank debit while allocating the purchase in reports.</Text></View>
                  </TouchableOpacity>
                  {splitEnabled && <TransactionSplitEditor total={selectedDraft?.amount || 0} splits={splits} categories={confirmCategories} onChange={setSplits} formatCurrency={formatCurrency} tagSuggestions={uniqueTags} tagSuggestionsForCategory={tagsForCategory} />}
                </View>
              )}

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

              {recurringSuggestion && !dismissedRecurringSuggestion && !makeRecurring && <View className="rounded-2xl p-4 mb-3 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800">
                <View className="flex-row items-start"><FontAwesome name="magic" size={16} color="#7c3aed" /><View className="flex-1 ml-3"><Text className="text-violet-900 dark:text-violet-200 font-bold">Looks {recurringSuggestion.frequency.toLowerCase()}</Text><Text className="text-violet-700 dark:text-violet-300 text-xs mt-1">{recurringSuggestion.reason} Confidence {recurringSuggestion.confidence}%.</Text><View className="flex-row mt-3 gap-2"><TouchableOpacity onPress={() => { setRecurringFrequency(recurringSuggestion.frequency); setMakeRecurring(true); }} className="bg-violet-600 px-3 py-2 rounded-xl"><Text className="text-white text-xs font-bold">{t('useSuggestion')}</Text></TouchableOpacity><TouchableOpacity onPress={() => setDismissedRecurringSuggestion(true)} className="px-3 py-2 rounded-xl bg-white dark:bg-slate-900"><Text className="text-slate-600 dark:text-slate-300 text-xs font-bold">{t('dismiss')}</Text></TouchableOpacity></View></View></View>
              </View>}

              <View className="rounded-2xl p-4 mb-6 bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700">
                <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: makeRecurring }} onPress={() => setMakeRecurring(!makeRecurring)} className="flex-row items-center">
                  <View className={`w-7 h-7 rounded-lg justify-center items-center mr-3 ${makeRecurring ? 'bg-indigo-600' : 'bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600'}`}>
                    {makeRecurring && <FontAwesome name="check" size={13} color="#fff" />}
                  </View>
                  <View className="flex-1">
                    <Text className="text-slate-900 dark:text-white font-bold">Make this recurring</Text>
                    <Text className="text-slate-500 dark:text-slate-400 text-xs mt-0.5">The next occurrence is scheduled after this SMS transaction.</Text>
                  </View>
                  <FontAwesome name="repeat" size={17} color="#6366f1" />
                </TouchableOpacity>
                {makeRecurring && <View className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
                  <View className="flex-row flex-wrap gap-2 mb-4">
                    {(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as RecurringFrequency[]).map(item => <TouchableOpacity key={item} onPress={() => setRecurringFrequency(item)} className={`px-3 py-2 rounded-xl ${recurringFrequency === item ? 'bg-indigo-600' : 'bg-white dark:bg-slate-900'}`}><Text className={`text-[10px] font-bold ${recurringFrequency === item ? 'text-white' : 'text-slate-600 dark:text-slate-300'}`}>{item}</Text></TouchableOpacity>)}
                  </View>
                  <View className="flex-row gap-2 mb-3"><View className="flex-1"><Text className="text-slate-500 dark:text-slate-400 text-[10px] mb-1">{t('nextDueOptional')}</Text><TextInput value={recurringNextDate} onChangeText={setRecurringNextDate} placeholder="YYYY-MM-DD" placeholderTextColor="#94a3b8" keyboardType="numbers-and-punctuation" className="bg-white dark:bg-slate-900 rounded-xl px-3 py-2 text-slate-900 dark:text-white" /></View><View className="flex-1"><Text className="text-slate-500 dark:text-slate-400 text-[10px] mb-1">{t('endDateOptional')}</Text><TextInput value={recurringEndDate} onChangeText={setRecurringEndDate} placeholder="YYYY-MM-DD" placeholderTextColor="#94a3b8" keyboardType="numbers-and-punctuation" className="bg-white dark:bg-slate-900 rounded-xl px-3 py-2 text-slate-900 dark:text-white" /></View></View>
                  <View className="mb-3"><Text className="text-slate-500 dark:text-slate-400 text-[10px] mb-1">{t('futureOccurrencesOptional')}</Text><TextInput value={recurringOccurrences} onChangeText={setRecurringOccurrences} placeholder={t('noLimit')} placeholderTextColor="#94a3b8" keyboardType="number-pad" className="bg-white dark:bg-slate-900 rounded-xl px-3 py-2 text-slate-900 dark:text-white" /></View>
                  <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: reminderEnabled }} onPress={() => setReminderEnabled(!reminderEnabled)} className="flex-row items-center mb-3">
                    <FontAwesome name={reminderEnabled ? 'check-square' : 'square-o'} size={18} color={reminderEnabled ? '#6366f1' : '#94a3b8'} />
                    <Text className="text-slate-700 dark:text-slate-300 text-xs font-semibold ml-2">Reminder enabled</Text>
                  </TouchableOpacity>
                  {reminderEnabled && <View className="flex-row gap-2">
                    <View className="flex-1"><Text className="text-slate-500 dark:text-slate-400 text-[10px] mb-1">{t('reminderDaysBefore')}</Text><TextInput value={reminderDaysBefore} onChangeText={setReminderDaysBefore} keyboardType="numbers-and-punctuation" placeholder="7, 1, 0" className="bg-white dark:bg-slate-900 rounded-xl px-3 py-2 text-slate-900 dark:text-white" /></View>
                    <View className="flex-1"><Text className="text-slate-500 dark:text-slate-400 text-[10px] mb-1">Time (HH:MM)</Text><TextInput value={reminderTime} onChangeText={setReminderTime} keyboardType="numbers-and-punctuation" className="bg-white dark:bg-slate-900 rounded-xl px-3 py-2 text-slate-900 dark:text-white" /></View>
                  </View>}
                </View>}
              </View>

              {/* Technical Details */}
              <View className="bg-slate-50 dark:bg-slate-800 rounded-2xl p-4 mb-6">
                <View className="flex-row justify-between mb-2">
                  <Text className="text-slate-500 dark:text-slate-400 text-sm">Date</Text>
                  <Text className="text-slate-900 dark:text-white font-medium">
                    {formatDate(selectedDraft?.date || 0)} {formatTime(selectedDraft?.date || 0)}
                  </Text>
                </View>
                {selectedDraft?.fees && selectedDraft.service_charge === undefined && selectedDraft.disaster_recovery_fee === undefined && (
                  <View className="flex-row justify-between mb-2">
                    <Text className="text-slate-500 dark:text-slate-400 text-sm">Bank Fees</Text>
                    <Text className="text-slate-900 dark:text-white font-medium">{formatCurrency(selectedDraft.fees)}</Text>
                  </View>
                )}
                {selectedDraft?.service_charge !== undefined && (
                  <View className="flex-row justify-between mb-2">
                    <Text className="text-slate-500 dark:text-slate-400 text-sm">Service charge</Text>
                    <Text className="text-slate-900 dark:text-white font-medium">{formatCurrency(selectedDraft.service_charge)}</Text>
                  </View>
                )}
                {selectedDraft?.vat !== undefined && (
                  <View className="flex-row justify-between mb-2">
                    <Text className="text-slate-500 dark:text-slate-400 text-sm">VAT</Text>
                    <Text className="text-slate-900 dark:text-white font-medium">{formatCurrency(selectedDraft.vat)}</Text>
                  </View>
                )}
                {selectedDraft?.disaster_recovery_fee !== undefined && (
                  <View className="flex-row justify-between mb-2">
                    <Text className="text-slate-500 dark:text-slate-400 text-sm">Disaster Recovery</Text>
                    <Text className="text-slate-900 dark:text-white font-medium">{formatCurrency(selectedDraft.disaster_recovery_fee)}</Text>
                  </View>
                )}
                {selectedDraft?.gross_amount !== undefined && (
                  <View className="flex-row justify-between mb-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                    <Text className="text-slate-700 dark:text-slate-300 text-sm font-bold">Total account debit</Text>
                    <Text className="text-slate-900 dark:text-white font-bold">{formatCurrency(selectedDraft.gross_amount)}</Text>
                  </View>
                )}
                {selectedDraft?.tax && selectedDraft.vat === undefined && (
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
                <View className="bg-slate-100 dark:bg-[rgba(30,41,59,0.5)] p-3 rounded-xl border border-dotted border-slate-300 dark:border-slate-700">
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
