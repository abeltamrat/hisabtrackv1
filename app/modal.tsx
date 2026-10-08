import { useTransactions } from '@/context/TransactionContext';
import CategoryIcon from '@/components/CategoryIcon';
import { useAppSettings } from '@/contexts/AppSettingsContext';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Modal, Platform, ScrollView, Text, TextInput, TouchableOpacity, View, useColorScheme } from 'react-native';
import { Alert } from '@/utils/alert';
import { useFormErrors } from '@/hooks/useFormErrors';

import { AppDispatch } from '@/store';
import BudgetService from '@/services/BudgetService';
import { fetchAccounts } from '@/store/slices/accountsSlice';
import { addTransaction, deleteTransaction, updateTransaction, fetchTransactions } from '@/store/slices/transactionsSlice';
import { fetchBudgets } from '@/store/slices/budgetsSlice';
import { NotificationService } from '@/services/NotificationService';
import { formatTagInput, parseTagInput } from '@/utils/tags';
import FloatingCalculator from '@/components/FloatingCalculator';
import { useDispatch, useSelector } from 'react-redux';
import { themeTokens } from '@/constants/theme';
import { RecurringTransactionService } from '@/services/RecurringTransactionService';
import type { RecurringFrequency, TransactionType } from '@/types/database';
import { formatCalendarDate } from '@/utils/ethiopianCalendar';
import type { TransactionSplit } from '@/types/database';
import TransactionSplitEditor from '@/components/TransactionSplitEditor';
import { money, sumMoney } from '@/utils/finance';
import { useI18n } from '@/contexts/I18nContext';
import { rankTagSuggestions } from '@/utils/tagSuggestions';
import { InputDraftService, type SmartInputDraft } from '@/services/InputDraftService';

const SpinnerPickerSheet = ({
  show, value, mode, label, onClose, onConfirm, maximumDate,
}: {
  show: boolean; value: Date; mode: 'date' | 'time'; label: string;
  onClose: () => void; onConfirm: (d: Date) => void; maximumDate?: Date;
}) => {
  const pendingRef = React.useRef<Date>(value);
  const isDark = useColorScheme() === 'dark';
  const theme = themeTokens(isDark);
  React.useEffect(() => { if (show) pendingRef.current = value; }, [show]);
  if (!show) return null;
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
        <TouchableOpacity style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} activeOpacity={1} onPress={onClose} />
        <View style={{ backgroundColor: theme.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.border }}>
            <TouchableOpacity onPress={onClose}>
              <Text style={{ color: '#94a3b8', fontSize: 16 }}>Cancel</Text>
            </TouchableOpacity>
            <Text style={{ color: theme.text, fontWeight: '700', fontSize: 16 }}>{label}</Text>
            <TouchableOpacity onPress={() => { onClose(); onConfirm(pendingRef.current); }}>
              <Text style={{ color: '#6366f1', fontWeight: '700', fontSize: 16 }}>Done</Text>
            </TouchableOpacity>
          </View>
          <DateTimePicker
            value={value}
            mode={mode}
            display="spinner"
            maximumDate={maximumDate}
            style={{ height: 200, alignSelf: 'center', width: '100%' }}
            onChange={(_, d) => { if (d) pendingRef.current = d; }}
          />
        </View>
      </View>
    </Modal>
  );
};

export default function AddTransactionScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const dispatch = useDispatch<AppDispatch>();
  const { formatCurrency, currency, calendarSystem } = useAppSettings();
  const accounts = useSelector((state: any) => state.accounts.items);
  const transactions = useSelector((state: any) => state.transactions.items);
  const budgets = useSelector((state: any) => state.budgets.items);
  const accountsStatus = useSelector((state: any) => state.accounts.status);
  const { categories } = useTransactions();

  const currencySymbol = useMemo(() => {
    return formatCurrency(0).replace(/[\d,.\s]/g, '').trim() || currency;
  }, [currency, formatCurrency]);

  const { edit, draft } = useLocalSearchParams<{ edit?: string; draft?: string }>();

  const isEditing = !!edit;
  const editingTransaction = transactions.find((t: any) => t.id === edit);

  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const { errors, validate, clearError } = useFormErrors<'amount' | 'account' | 'category'>();
  const [type, setType] = useState<TransactionType>('EXPENSE');
  const [toAccountId, setToAccountId] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [note, setNote] = useState('');
  const [recipient, setRecipient] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [transactionDate, setTransactionDate] = useState<Date>(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [makeRecurring, setMakeRecurring] = useState(false);
  const [frequency, setFrequency] = useState<RecurringFrequency>('MONTHLY');
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [reminderDaysBefore, setReminderDaysBefore] = useState('1');
  const [reminderTime, setReminderTime] = useState('09:00');
  const [recurringNextDate, setRecurringNextDate] = useState('');
  const [recurringEndDate, setRecurringEndDate] = useState('');
  const [recurringOccurrences, setRecurringOccurrences] = useState('');
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [splits, setSplits] = useState<TransactionSplit[]>([]);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [kbdHeight, setKbdHeight] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const [inputDraft, setInputDraft] = useState<SmartInputDraft>();

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, e => setKbdHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(hideEvent, () => setKbdHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  const uniqueTags = useMemo(() => rankTagSuggestions(transactions, {
    category: selectedCategory,
    timestamp: transactionDate.getTime(),
  }), [selectedCategory, transactionDate, transactions]);
  const tagsForCategory = (category: string) => rankTagSuggestions(transactions, {
    category,
    timestamp: transactionDate.getTime(),
  });

  const handleToggleTag = (tagToToggle: string) => {
    const currentTags = parseTagInput(tagsInput) || [];
    const exists = currentTags.some(t => t.toLowerCase() === tagToToggle.toLowerCase());
    const newTags = exists
      ? currentTags.filter(t => t.toLowerCase() !== tagToToggle.toLowerCase())
      : [...currentTags, tagToToggle];
    setTagsInput(newTags.join(', '));
  };

  const toggleCollapse = (id: string) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    if (accounts.length === 0) dispatch(fetchAccounts());
    if (budgets.length === 0) dispatch(fetchBudgets());
    if (transactions.length === 0) dispatch(fetchTransactions());
  }, [dispatch, accounts.length, budgets.length, transactions.length]);

  useEffect(() => {
    if (isEditing && editingTransaction) {
      setSelectedAccountId(editingTransaction.account_id);
      setAmount(editingTransaction.amount.toString());
      setType(editingTransaction.type);
      setToAccountId(editingTransaction.to_account_id || '');
      setSelectedCategory(editingTransaction.category);
      setNote(editingTransaction.description !== editingTransaction.category ? editingTransaction.description : '');
      setRecipient(editingTransaction.sender_receiver || '');
      setTagsInput(formatTagInput(editingTransaction.tags));
      setTransactionDate(new Date(editingTransaction.date));
      setSplitEnabled(!!editingTransaction.splits?.length);
      setSplits(editingTransaction.splits || []);
    }
  }, [isEditing, editingTransaction]);

  useEffect(() => {
    if (!draft) return;
    let active = true;
    InputDraftService.get(draft).then(value => {
      if (!active || !value) return;
      setInputDraft(value);
      if (value.accountId) setSelectedAccountId(value.accountId);
      setAmount(value.amount.toString());
      setType(value.type);
      if (value.category) setSelectedCategory(value.category);
      if (value.recipient) setRecipient(value.recipient);
      if (value.description) setNote(value.description);
      if (value.date) setTransactionDate(new Date(value.date));
      setTagsInput(formatTagInput(value.tags));
      if (value.splits?.length) { setSplits(value.splits); setSplitEnabled(true); }
    });
    return () => { active = false; };
  }, [draft]);

  useEffect(() => {
    if (!selectedAccountId && accounts.length > 0) {
      setSelectedAccountId(accounts[0].id);
    } else if (accountsStatus === 'succeeded' && accounts.length === 0) {
      if (Platform.OS === 'web') {
        setTimeout(() => {
          if (confirm("No Accounts Found. You need an account to create a transaction. Would you like to create one?")) {
            router.replace('/accounts');
          } else {
            router.back();
          }
        }, 100);
      } else {
        Alert.alert(
          "No Accounts Found",
          "You need an account to create a transaction. Would you like to create one?",
          [
            { text: "Cancel", onPress: () => router.back(), style: "cancel" },
            { text: "Create Account", onPress: () => router.replace('/accounts') }
          ]
        );
      }
    }
  }, [accounts, selectedAccountId, accountsStatus]);

  const handleSave = async () => {
    const numericAmount = parseFloat(amount);
    if (!validate({
      amount: (!amount || isNaN(numericAmount) || numericAmount <= 0)
        && 'Enter an amount greater than zero.',
      account: !selectedAccountId && 'Choose the account this belongs to.',
      category: type !== 'TRANSFER' && !selectedCategory && 'Choose a category.',
    })) return;
    if (type === 'TRANSFER' && (!toAccountId || toAccountId === selectedAccountId)) {
      Alert.alert('Choose destination', 'Select a different account to receive the transfer.');
      return;
    }
    if (splitEnabled && (splits.length < 2 || splits.some(item => !item.category.trim() || money(item.amount) <= 0) || sumMoney(splits.map(item => item.amount)) !== money(numericAmount))) {
      Alert.alert('Check split amounts', `Use at least two positive parts that add up to ${formatCurrency(numericAmount)}.`);
      return;
    }

    // Soft guard: warn when a new expense exceeds the account's available
    // (unlocked) balance. Never hard-block — records mirror real money moves.
    if (!isEditing && type === 'EXPENSE') {
      const sourceAccount = accounts.find((a: any) => a.id === selectedAccountId);
      if (sourceAccount) {
        const lockedAmount = sourceAccount.locked_amount ?? 0;
        const available = (sourceAccount.balance ?? 0) - lockedAmount;
        if (numericAmount > available) {
          const proceed = await new Promise<boolean>((resolve) => {
            Alert.alert(
              'Insufficient Balance',
              `${sourceAccount.name} only has ${formatCurrency(Math.max(available, 0))} available${lockedAmount > 0 ? ` (${formatCurrency(lockedAmount)} is locked)` : ''}. Record this expense anyway?`,
              [
                { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
                { text: 'Record Anyway', onPress: () => resolve(true) },
              ]
            );
          });
          if (!proceed) return;
        }
      }
    }

    const transactionData = {
      account_id: selectedAccountId,
      amount: numericAmount,
      type,
      category: type === 'TRANSFER' ? 'Transfer' : selectedCategory,
      description: note || (type === 'TRANSFER' ? 'Bank transfer' : selectedCategory),
      sender_receiver: recipient.trim() || undefined,
      operation_id: inputDraft ? `smart-input:${inputDraft.fingerprint}` : editingTransaction?.operation_id,
      tags: parseTagInput(tagsInput),
      date: transactionDate.getTime(),
      ...(type === 'TRANSFER' ? { to_account_id: toAccountId } : {}),
      ...(type !== 'TRANSFER' && splitEnabled ? { splits } : { splits: undefined }),
    };

    if (type === 'EXPENSE') {
      const budget = budgets.find((b: any) => b.category === selectedCategory);
      if (budget) {
        const metrics = BudgetService.calculateBudgetMetrics(
          budget, budgets, transactions,
          isEditing ? { excludeTransactionId: edit } : undefined
        );
        const newTotal = metrics.spent + numericAmount;
        const limit = metrics.effectiveLimit;
        const percentage = limit > 0 ? newTotal / limit : 0;

        if (newTotal > limit) {
          await NotificationService.showImmediateNotification(
            'Budget Exceeded',
            `You've exceeded your ${selectedCategory} budget by ${formatCurrency(newTotal - limit)}!`,
            { actionType: 'view_budget', inAppType: 'alert', icon: 'exclamation-circle', color: '#ef4444', channelId: 'finance_alerts' }
          );
        } else if (percentage >= 0.9) {
          await NotificationService.showImmediateNotification(
            'Budget Alert',
            `You're at ${(percentage * 100).toFixed(0)}% of your ${selectedCategory} budget.`,
            { actionType: 'view_budget', inAppType: 'warning', icon: 'exclamation-triangle', color: '#f59e0b', channelId: 'finance_alerts' }
          );
        }
      }
    }

    let result: any;
    if (isEditing) {
      result = await dispatch(updateTransaction({ id: edit!, ...transactionData }));
      if (updateTransaction.rejected.match(result)) {
        Alert.alert('Error', result.error?.message || 'Failed to update transaction.');
        return;
      }
    } else {
      result = await dispatch(addTransaction(transactionData as any));
      if (addTransaction.rejected.match(result)) {
        Alert.alert('Error', result.error?.message || 'Failed to save transaction.');
        return;
      }
    }
    let createdRecurringId: string | undefined;
    if (!isEditing && makeRecurring) {
      const match = /^(\d{1,2}):(\d{2})$/.exec(reminderTime.trim());
      const hour = match ? Number(match[1]) : -1;
      const minute = match ? Number(match[2]) : -1;
      if (reminderEnabled && (hour < 0 || hour > 23 || minute < 0 || minute > 59)) {
        Alert.alert('Transaction saved', 'The transaction was recorded, but the recurring rule was not created because the reminder time must use HH:MM.');
        return;
      }
      try {
        const recurringRule = await RecurringTransactionService.create({
          name: note.trim() || (type === 'TRANSFER' ? 'Bank transfer' : selectedCategory),
          amount: numericAmount,
          type,
          category: type === 'TRANSFER' ? 'Transfer' : selectedCategory,
          accountId: selectedAccountId,
          toAccountId: type === 'TRANSFER' ? toAccountId : undefined,
          description: note,
          tags: parseTagInput(tagsInput),
          frequency,
          startDate: transactionDate.getTime(),
          reminderEnabled,
          reminderDaysBefore: Number(reminderDaysBefore) || 0,
          reminderDaysBeforeList: reminderDaysBefore.split(',').map(value => Number(value.trim())).filter(Number.isFinite),
          reminderHour: Math.max(0, hour),
          reminderMinute: Math.max(0, minute),
          splits: splitEnabled ? splits : undefined,
          nextDate: recurringNextDate ? new Date(`${recurringNextDate}T12:00:00`).getTime() : undefined,
          endDate: recurringEndDate ? new Date(`${recurringEndDate}T23:59:59`).getTime() : undefined,
          totalRepetitions: recurringOccurrences ? Number(recurringOccurrences) : undefined,
          calendar_system: calendarSystem === 'ETHIOPIAN' ? 'ETHIOPIAN' : 'GREGORIAN',
        });
        createdRecurringId = recurringRule.id;
      } catch (error: any) {
        Alert.alert('Transaction saved', error?.message || 'The recurring rule could not be created.');
        return;
      }
    }
    const transactionId = (result.payload as any)?.id as string | undefined;
    const savedTransactionId = transactionId || (isEditing ? edit : undefined);
    if (inputDraft && savedTransactionId) {
      await InputDraftService.markUsed(inputDraft.fingerprint);
      await InputDraftService.attachToTransaction(inputDraft, savedTransactionId);
    }
    if (!isEditing && transactionId) {
      Alert.alert('Transaction saved', 'The account balance and reports have been updated.', [
        { text: 'Keep', style: 'cancel', onPress: () => router.back() },
        { text: 'Undo', style: 'destructive', onPress: async () => {
          try {
            if (createdRecurringId) await RecurringTransactionService.remove(createdRecurringId);
            await dispatch(deleteTransaction(transactionId)).unwrap();
            if (inputDraft) await InputDraftService.markUnused(inputDraft.fingerprint);
            await dispatch(fetchAccounts());
            router.back();
          } catch {
            Alert.alert('Undo failed', 'The transaction could not be reversed.');
          }
        } },
      ], { cancelable: false });
      return;
    }
    router.back();
  };

  const filteredCategories = categories.filter(c => c.type === (type === 'TRANSFER' ? 'expense' : type.toLowerCase()));

  const allSelectableCategories = filteredCategories;

  useEffect(() => {
    if (!selectedCategory && allSelectableCategories.length > 0) {
      setSelectedCategory(allSelectableCategories[0].name);
    }
  }, [allSelectableCategories, selectedCategory]);

  const selectedBudgetMetrics = useMemo(() => {
    if (type !== 'EXPENSE' || !selectedCategory) return null;
    const budget = budgets.find((item: any) => item.category === selectedCategory);
    if (!budget) return null;
    return BudgetService.calculateBudgetMetrics(
      budget, budgets, transactions,
      isEditing ? { excludeTransactionId: edit } : undefined
    );
  }, [budgets, edit, isEditing, selectedCategory, transactions, type]);

  const parsedTags = useMemo(() => parseTagInput(tagsInput) || [], [tagsInput]);

  const renderCategoryTree = (parentId: string | undefined, depth: number): React.ReactNode => {
    const cats = filteredCategories.filter(c => (c.parentId ?? undefined) === parentId);
    return cats.map(category => {
      const children = filteredCategories.filter(c => c.parentId === category.id);
      const hasChildren = children.length > 0;
      const isCollapsed = collapsedCategories.has(category.id);
      const indentLeft = depth * 14;
      const iconSize = depth === 0 ? 32 : 26;
      const iconInnerSize = depth === 0 ? 15 : 12;

      return (
        <View key={category.id}>
          <TouchableOpacity
            className={`flex-row items-center py-2 px-3 rounded-xl mb-1 border ${ selectedCategory === category.name ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-500' : 'bg-slate-50 dark:bg-slate-900 border-transparent' }`}
            style={{ marginLeft: indentLeft }}
            onPress={() => { clearError('category'); setSelectedCategory(category.name); }}
          >
            {depth > 0 && (
              <View className="w-0.5 h-3 bg-slate-300 dark:bg-slate-600 mr-2 rounded-full" />
            )}
            <View
              className="rounded-xl justify-center items-center mr-2"
              style={{ width: iconSize, height: iconSize, backgroundColor: category.color + '20' }}
            >
              <CategoryIcon icon={category.icon} size={iconInnerSize} color={category.color} />
            </View>
            <Text
              className={`flex-1 text-slate-900 dark:text-white font-semibold ${depth === 0 ? 'text-sm' : 'text-xs'}`}
              numberOfLines={1}
            >
              {category.name}
            </Text>
            {hasChildren && (
              <TouchableOpacity
                onPress={() => toggleCollapse(category.id)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                className="flex-row items-center px-1"
              >
                <Text className="text-slate-500 text-[10px] mr-1 dark:text-slate-400">{children.length}</Text>
                <FontAwesome name={isCollapsed ? 'chevron-right' : 'chevron-down'} size={9} color="#94a3b8" />
              </TouchableOpacity>
            )}
            {selectedCategory === category.name && (
              <FontAwesome name="check" size={11} color="#6366f1" style={{ marginLeft: 4 }} />
            )}
          </TouchableOpacity>
          {hasChildren && !isCollapsed && renderCategoryTree(category.id, depth + 1)}
        </View>
      );
    });
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      enabled={Platform.OS === 'ios'}
      className="flex-1 bg-slate-50 dark:bg-background-dark"
    >
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style={Platform.OS === 'ios' ? 'light' : 'auto'} />

      {/* Header */}
      <LinearGradient
        colors={['#4f46e5', '#4338ca']}
        className="px-6 pt-6 pb-6 rounded-b-[28px]"
        style={{ elevation: 4 }}
      >
        <View className="flex-row justify-between items-center mb-4">
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close" onPress={() => router.back()} className="w-9 h-9 bg-white/20 rounded-xl justify-center items-center">
            <FontAwesome name="close" size={16} color="#fff" />
          </TouchableOpacity>
          <Text className="text-white text-lg font-bold">{isEditing ? 'Edit Transaction' : 'Add Transaction'}</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Confirm" onPress={handleSave} className="w-9 h-9 bg-secondary-500 rounded-xl justify-center items-center">
            <FontAwesome name="check" size={16} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Amount Input */}
        <View className="items-center mb-2">
          <Text className="text-primary-100 text-xs mb-1">How much?</Text>
          <View className="flex-row items-center">
            <Text className="text-white text-4xl font-bold mr-1">{currencySymbol}</Text>
            <TextInput
              className="text-white text-5xl font-bold min-w-[120px] text-center"
              placeholder="0"
              placeholderTextColor="rgba(255,255,255,0.5)"
              keyboardType="decimal-pad"
              value={amount}
              onChangeText={(value) => { clearError('amount'); setAmount(value); }}
              accessibilityLabel="Amount"
              aria-invalid={!!errors.amount}
              autoFocus
            />
          </View>
          {errors.amount ? (
            <Text accessibilityRole="alert" className="text-white bg-red-600/90 px-3 py-1.5 rounded-lg text-xs font-semibold mt-2 self-center">
              {errors.amount}
            </Text>
          ) : null}
        </View>
      </LinearGradient>

      <ScrollView
        ref={scrollRef}
        className="flex-1 px-4 -mt-4"
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled={true}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: kbdHeight > 0 ? kbdHeight + 16 : 32 }}
      >
        {!isEditing && !draft && <TouchableOpacity onPress={() => router.push('/smart-input' as any)} className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-2xl p-3 mb-3 flex-row items-center"><FontAwesome name="magic" size={16} color="#6366f1" /><View className="ml-3 flex-1"><Text className="text-indigo-700 dark:text-indigo-300 font-bold">Use smart input</Text><Text className="text-indigo-600/70 dark:text-indigo-300/70 text-[10px]">Type a phrase or scan a receipt, then review here.</Text></View><FontAwesome name="chevron-right" size={12} color="#6366f1" /></TouchableOpacity>}
        {/* Type Selector */}
        <View className="bg-white dark:bg-slate-800 rounded-2xl p-3 mb-3 shadow border border-slate-100 dark:border-slate-700" style={{ elevation: 3 }}>
          <Text className="text-slate-900 dark:text-white text-xs font-bold mb-2">Transaction Type</Text>
          <View className="flex-row bg-slate-50 dark:bg-slate-900 p-1 rounded-xl">
            <TouchableOpacity
              className={`flex-1 py-2.5 rounded-lg items-center ${type === 'EXPENSE' ? 'bg-white dark:bg-slate-700' : ''}`}
              style={type === 'EXPENSE' ? { elevation: 2 } : {}}
              onPress={() => setType('EXPENSE')}
            >
              <View className="flex-row items-center">
                <FontAwesome name="arrow-up" size={13} color={type === 'EXPENSE' ? '#ef4444' : '#94a3b8'} />
                <Text className={`ml-1.5 text-xs font-bold ${type === 'EXPENSE' ? 'text-red-500' : 'text-slate-500'} dark:text-slate-400`}>Expense</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              className={`flex-1 py-2.5 rounded-lg items-center ${type === 'INCOME' ? 'bg-white dark:bg-slate-700' : ''}`}
              style={type === 'INCOME' ? { elevation: 2 } : {}}
              onPress={() => setType('INCOME')}
            >
              <View className="flex-row items-center">
                <FontAwesome name="arrow-down" size={13} color={type === 'INCOME' ? '#10b981' : '#94a3b8'} />
                <Text className={`ml-1.5 text-xs font-bold ${type === 'INCOME' ? 'text-green-600' : 'text-slate-500'} dark:text-slate-400`}>Income</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              className={`flex-1 py-2.5 rounded-lg items-center ${type === 'TRANSFER' ? 'bg-white dark:bg-slate-700' : ''}`}
              style={type === 'TRANSFER' ? { elevation: 2 } : {}}
              onPress={() => setType('TRANSFER')}
            >
              <View className="flex-row items-center">
                <FontAwesome name="exchange" size={13} color={type === 'TRANSFER' ? '#6366f1' : '#94a3b8'} />
                <Text className={`ml-1.5 text-xs font-bold ${type === 'TRANSFER' ? 'text-indigo-600' : 'text-slate-500'} dark:text-slate-400`}>Transfer</Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>

        {/* Account Selection */}
        <View className="bg-white dark:bg-slate-800 rounded-2xl p-3 mb-3 shadow border border-slate-100 dark:border-slate-700" style={{ elevation: 3 }}>
          <Text className="text-slate-900 dark:text-white text-xs font-bold mb-2">Account</Text>
          {errors.account ? (
            <Text accessibilityRole="alert" className="text-red-600 dark:text-red-400 text-xs font-semibold mb-2">{errors.account}</Text>
          ) : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-1">
            {accounts.map((account: any) => (
              <TouchableOpacity
                key={account.id}
                onPress={() => { clearError('account'); setSelectedAccountId(account.id); }}
                className={`mx-1 p-3 rounded-xl border-2 min-w-[90px] items-center ${ selectedAccountId === account.id ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-500' : 'bg-slate-50 dark:bg-slate-900 border-transparent' }`}
              >
                <View className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-800 justify-center items-center mb-1.5">
                  <FontAwesome
                    name={account.type === 'CASH' ? 'money' : account.type === 'MOBILE_MONEY' ? 'mobile' : 'bank'}
                    size={15}
                    color={selectedAccountId === account.id ? '#6366f1' : '#94a3b8'}
                  />
                </View>
                <Text className="text-slate-900 dark:text-white text-[11px] font-bold mb-0.5" numberOfLines={1}>{account.name}</Text>
                <Text className="text-slate-500 dark:text-slate-400 text-[10px]">{formatCurrency(account.balance)}</Text>
              </TouchableOpacity>
            ))}
            {accounts.length === 0 && (
              <TouchableOpacity
                onPress={() => router.replace('/accounts')}
                className="p-3 items-center justify-center bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700"
              >
                <FontAwesome name="plus-circle" size={20} color="#6366f1" />
                <Text className="text-slate-900 dark:text-white font-bold mt-1 text-xs">No Accounts</Text>
                <Text className="text-slate-500 dark:text-slate-400 text-[10px] text-center mt-0.5">Tap to create one.</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>

        {type === 'TRANSFER' && (
          <View className="bg-white dark:bg-slate-800 rounded-2xl p-3 mb-3 shadow border border-slate-100 dark:border-slate-700" style={{ elevation: 3 }}>
            <Text className="text-slate-900 dark:text-white text-xs font-bold mb-2">Destination account</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-1">
              {accounts.filter((item: any) => item.id !== selectedAccountId).map((item: any) => (
                <TouchableOpacity
                  key={item.id}
                  onPress={() => setToAccountId(item.id)}
                  className={`mx-1 p-3 rounded-xl border-2 min-w-[110px] items-center ${toAccountId === item.id ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-500' : 'bg-slate-50 dark:bg-slate-900 border-transparent'}`}
                >
                  <FontAwesome name="bank" size={15} color={toAccountId === item.id ? '#6366f1' : '#94a3b8'} />
                  <Text className="text-slate-900 dark:text-white text-[11px] font-bold mt-1" numberOfLines={1}>{item.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Date Picker */}
        <View className="bg-white dark:bg-slate-800 rounded-2xl p-3 mb-3 shadow border border-slate-100 dark:border-slate-700" style={{ elevation: 3 }}>
          <Text className="text-slate-900 dark:text-white text-xs font-bold mb-2">Date</Text>
          <TouchableOpacity
            onPress={() => {
              if (Platform.OS === 'android') {
                DateTimePickerAndroid.open({
                  value: transactionDate,
                  mode: 'date',
                  display: 'default',
                  maximumDate: new Date(),
                  onChange: (event: any, selectedDate?: Date) => {
                    if (event.type === 'set' && selectedDate) setTransactionDate(selectedDate);
                  },
                });
              } else {
                setShowDatePicker(true);
              }
            }}
            className="flex-row items-center bg-slate-50 dark:bg-slate-900 p-3 rounded-xl"
          >
            <FontAwesome name="calendar" size={15} color="#6366f1" />
            <Text className="text-slate-900 dark:text-white text-sm font-medium ml-2.5">
              {formatCalendarDate(transactionDate, calendarSystem, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}
            </Text>
          </TouchableOpacity>
          {showDatePicker && Platform.OS === 'ios' && (
            <DateTimePicker
              value={transactionDate}
              mode="date"
              display="spinner"
              maximumDate={new Date()}
              onChange={(_, selected) => { if (selected) setTransactionDate(selected); }}
            />
          )}
        </View>

        {/* Category Selection */}
        {type !== 'TRANSFER' && <View className={`bg-white dark:bg-slate-800 rounded-2xl p-3 mb-3 shadow border ${errors.category ? 'border-red-500' : 'border-slate-100 dark:border-slate-700'}`} style={{ elevation: 3 }}>
          {errors.category ? (
            <Text accessibilityRole="alert" className="text-red-600 dark:text-red-400 text-xs font-semibold mb-2">{errors.category}</Text>
          ) : null}
          <View className="flex-row justify-between items-center mb-2">
            <Text className="text-slate-900 dark:text-white text-xs font-bold">Category</Text>
            {(() => {
              if (!selectedBudgetMetrics) return null;
              const currentAmount = parseFloat(amount) || 0;
              const total = selectedBudgetMetrics.spent + currentAmount;
              const percent = selectedBudgetMetrics.effectiveLimit > 0
                ? Math.min((total / selectedBudgetMetrics.effectiveLimit) * 100, 100)
                : 0;
              const isOver = total > selectedBudgetMetrics.effectiveLimit;
              return (
                <View className="flex-row items-center">
                  <Text className={`text-[10px] font-medium mr-2 ${isOver ? 'text-red-500' : percent > 90 ? 'text-amber-500' : 'text-slate-500'}`}>
                    {percent.toFixed(0)}% used
                  </Text>
                  <View className="w-12 h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                    <View
                      className={`h-full rounded-full ${isOver ? 'bg-red-500' : percent > 90 ? 'bg-amber-500' : 'bg-green-500'}`}
                      style={{ width: `${percent}%` }}
                    />
                  </View>
                  {selectedBudgetMetrics.rolloverDelta !== 0 && (
                    <Text className={`ml-1.5 text-[10px] font-semibold ${selectedBudgetMetrics.rolloverDelta > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {selectedBudgetMetrics.rolloverDelta > 0 ? '+' : ''}{selectedBudgetMetrics.rolloverDelta.toFixed(0)}
                    </Text>
                  )}
                </View>
              );
            })()}
          </View>
          <ScrollView showsVerticalScrollIndicator={false} className="max-h-52" nestedScrollEnabled={true}>
            {renderCategoryTree(undefined, 0)}
          </ScrollView>
        </View>}

        {type !== 'TRANSFER' && (
          <View className="bg-white dark:bg-slate-800 rounded-2xl p-3 mb-3 shadow border border-slate-100 dark:border-slate-700" style={{ elevation: 3 }}>
            <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: splitEnabled }} onPress={() => {
              const enabled = !splitEnabled;
              setSplitEnabled(enabled);
              if (enabled && splits.length === 0) setSplits([
                { id: `split-${Date.now()}-0`, amount: parseFloat(amount) || 0, category: selectedCategory || filteredCategories[0]?.name || 'Uncategorized' },
                { id: `split-${Date.now()}-1`, amount: 0, category: filteredCategories[1]?.name || filteredCategories[0]?.name || 'Uncategorized' },
              ]);
            }} className="flex-row items-center">
              <FontAwesome name={splitEnabled ? 'check-square' : 'square-o'} size={18} color={splitEnabled ? '#6366f1' : '#94a3b8'} />
              <View className="ml-2 flex-1"><Text className="text-slate-900 dark:text-white text-sm font-bold">Split across categories</Text><Text className="text-slate-500 dark:text-slate-400 text-[10px]">The account is charged once; reports use each allocation.</Text></View>
            </TouchableOpacity>
            {splitEnabled && <View className="mt-3"><TransactionSplitEditor total={parseFloat(amount) || 0} splits={splits} categories={filteredCategories} onChange={setSplits} formatCurrency={formatCurrency} tagSuggestions={uniqueTags} tagSuggestionsForCategory={tagsForCategory} /></View>}
          </View>
        )}

        {!isEditing && (
          <View className="bg-white dark:bg-slate-800 rounded-2xl p-3 mb-3 shadow border border-slate-100 dark:border-slate-700" style={{ elevation: 3 }}>
            <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: makeRecurring }} onPress={() => setMakeRecurring(!makeRecurring)} className="flex-row items-center">
              <View className={`w-6 h-6 rounded-lg justify-center items-center mr-3 ${makeRecurring ? 'bg-indigo-600' : 'border border-slate-300 dark:border-slate-600'}`}>
                {makeRecurring && <FontAwesome name="check" size={12} color="#fff" />}
              </View>
              <View className="flex-1">
                <Text className="text-slate-900 dark:text-white text-sm font-bold">Make this recurring</Text>
                <Text className="text-slate-500 dark:text-slate-400 text-[10px]">Create the next occurrence and an optional reminder.</Text>
              </View>
              <FontAwesome name="repeat" size={16} color="#6366f1" />
            </TouchableOpacity>
            {makeRecurring && (
              <View className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
                <Text className="text-slate-500 dark:text-slate-400 text-[10px] font-bold mb-2 uppercase">Frequency</Text>
                <View className="flex-row flex-wrap gap-2">
                  {(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as RecurringFrequency[]).map(item => (
                    <TouchableOpacity key={item} onPress={() => setFrequency(item)} className={`px-3 py-2 rounded-xl ${frequency === item ? 'bg-indigo-600' : 'bg-slate-100 dark:bg-slate-900'}`}>
                      <Text className={`text-[10px] font-bold ${frequency === item ? 'text-white' : 'text-slate-600 dark:text-slate-300'}`}>{item}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View className="flex-row mt-3 gap-2">
                  <View className="flex-1"><Text className="text-slate-500 dark:text-slate-400 text-[10px] mb-1">{t('nextDueOptional')}</Text><TextInput value={recurringNextDate} onChangeText={setRecurringNextDate} placeholder="YYYY-MM-DD" placeholderTextColor="#94a3b8" keyboardType="numbers-and-punctuation" className="bg-slate-50 dark:bg-slate-900 rounded-xl px-3 py-2 text-slate-900 dark:text-white" /></View>
                  <View className="flex-1"><Text className="text-slate-500 dark:text-slate-400 text-[10px] mb-1">{t('endDateOptional')}</Text><TextInput value={recurringEndDate} onChangeText={setRecurringEndDate} placeholder="YYYY-MM-DD" placeholderTextColor="#94a3b8" keyboardType="numbers-and-punctuation" className="bg-slate-50 dark:bg-slate-900 rounded-xl px-3 py-2 text-slate-900 dark:text-white" /></View>
                </View>
                <View className="mt-3"><Text className="text-slate-500 dark:text-slate-400 text-[10px] mb-1">{t('futureOccurrencesOptional')}</Text><TextInput value={recurringOccurrences} onChangeText={setRecurringOccurrences} placeholder={t('noLimit')} placeholderTextColor="#94a3b8" keyboardType="number-pad" className="bg-slate-50 dark:bg-slate-900 rounded-xl px-3 py-2 text-slate-900 dark:text-white" /></View>
                <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: reminderEnabled }} onPress={() => setReminderEnabled(!reminderEnabled)} className="flex-row items-center mt-4">
                  <FontAwesome name={reminderEnabled ? 'check-square' : 'square-o'} size={18} color={reminderEnabled ? '#6366f1' : '#94a3b8'} />
                  <Text className="text-slate-700 dark:text-slate-300 text-xs font-semibold ml-2">Remind me before it is due</Text>
                </TouchableOpacity>
                {reminderEnabled && (
                  <View className="flex-row mt-3 gap-2">
                    <View className="flex-1">
                      <Text className="text-slate-500 dark:text-slate-400 text-[10px] mb-1">{t('reminderDaysBefore')}</Text>
                      <TextInput value={reminderDaysBefore} onChangeText={setReminderDaysBefore} keyboardType="numbers-and-punctuation" placeholder="7, 1, 0" className="bg-slate-50 dark:bg-slate-900 rounded-xl px-3 py-2 text-slate-900 dark:text-white" />
                    </View>
                    <View className="flex-1">
                      <Text className="text-slate-500 dark:text-slate-400 text-[10px] mb-1">Time (HH:MM)</Text>
                      <TextInput value={reminderTime} onChangeText={setReminderTime} keyboardType="numbers-and-punctuation" className="bg-slate-50 dark:bg-slate-900 rounded-xl px-3 py-2 text-slate-900 dark:text-white" />
                    </View>
                  </View>
                )}
              </View>
            )}
          </View>
        )}

        {/* Tags Input */}
        <View className="bg-white dark:bg-slate-800 rounded-2xl p-3 mb-3 shadow border border-slate-100 dark:border-slate-700" style={{ elevation: 3 }}>
          <Text className="text-slate-900 dark:text-white text-xs font-bold mb-2">Tags (Optional)</Text>
          <View className="bg-slate-50 dark:bg-slate-900 px-3 py-2 rounded-xl">
            <TextInput
              className="text-slate-900 dark:text-white text-sm"
              placeholder="project-alpha, wedding, https://payment.link"
              placeholderTextColor="#94a3b8"
              value={tagsInput}
              onChangeText={setTagsInput}
              autoCapitalize="none"
              autoCorrect={false}
              onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100)}
            />
          </View>
          <Text className="text-slate-500 text-[10px] mt-1.5 dark:text-slate-400">Comma-separated. Great for projects, events, or links.</Text>
          {parsedTags.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-2 -mx-1 px-1">
              {parsedTags.map((tag) => (
                <View key={tag} className="mr-1.5 px-2.5 py-1 rounded-full bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800">
                  <Text className="text-indigo-700 dark:text-indigo-300 text-[11px] font-semibold">#{tag}</Text>
                </View>
              ))}
            </ScrollView>
          )}
          {uniqueTags.length > 0 && (
            <View className="mt-2">
              <Text className="text-[10px] text-slate-500 font-bold mb-1 uppercase dark:text-slate-400">Suggested Tags</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-1 px-1">
                {uniqueTags.map((tag) => {
                  const currentTags = parseTagInput(tagsInput) || [];
                  const isSelected = currentTags.some(t => t.toLowerCase() === tag.toLowerCase());
                  return (
                    <TouchableOpacity
                      key={tag}
                      onPress={() => handleToggleTag(tag)}
                      className={`mr-1.5 px-2.5 py-1 rounded-full border ${ isSelected ? 'bg-indigo-600 border-indigo-600' : 'bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-800' }`}
                    >
                      <Text className={`text-[11px] font-medium ${isSelected ? 'text-white' : 'text-slate-600 dark:text-slate-400'}`}>
                        #{tag}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}
        </View>

        {type !== 'TRANSFER' && <View className="bg-white dark:bg-slate-800 rounded-2xl p-3 mb-3 shadow border border-slate-100 dark:border-slate-700" style={{ elevation: 3 }}>
          <Text className="text-slate-900 dark:text-white text-xs font-bold mb-2">Recipient / Merchant (Optional)</Text>
          <View className="bg-slate-50 dark:bg-slate-900 px-3 py-2 rounded-xl"><TextInput className="text-slate-900 dark:text-white text-sm" placeholder="Who received or sent the money?" placeholderTextColor="#94a3b8" value={recipient} onChangeText={setRecipient} /></View>
        </View>}

        {/* Note Input */}
        <View className="bg-white dark:bg-slate-800 rounded-2xl p-3 mb-8 shadow border border-slate-100 dark:border-slate-700" style={{ elevation: 3 }}>
          <Text className="text-slate-900 dark:text-white text-xs font-bold mb-2">Note (Optional)</Text>
          <View className="bg-slate-50 dark:bg-slate-900 px-3 py-2 rounded-xl">
            <TextInput
              className="text-slate-900 dark:text-white text-sm min-h-[60px]"
              placeholder="Add a note about this transaction..."
              placeholderTextColor="#94a3b8"
              value={note}
              onChangeText={setNote}
              multiline
              textAlignVertical="top"
              onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100)}
            />
          </View>
        </View>
      </ScrollView>
      <FloatingCalculator onUseAmount={setAmount} />
    </KeyboardAvoidingView>
  );
}
