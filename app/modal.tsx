import { useTransactions } from '@/context/TransactionContext';
import CategoryIcon from '@/components/CategoryIcon';
import { useAppSettings } from '@/contexts/AppSettingsContext';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Keyboard, KeyboardAvoidingView, Modal, Platform, ScrollView, Text, TextInput, TouchableOpacity, View, useColorScheme } from 'react-native';

import { AppDispatch } from '@/store';
import BudgetService from '@/services/BudgetService';
import { fetchAccounts } from '@/store/slices/accountsSlice';
import { addTransaction, updateTransaction, fetchTransactions } from '@/store/slices/transactionsSlice';
import { fetchBudgets } from '@/store/slices/budgetsSlice';
import { NotificationService } from '@/services/NotificationService';
import { formatTagInput, parseTagInput } from '@/utils/tags';
import { useDispatch, useSelector } from 'react-redux';

const SpinnerPickerSheet = ({
  show, value, mode, label, onClose, onConfirm, maximumDate,
}: {
  show: boolean; value: Date; mode: 'date' | 'time'; label: string;
  onClose: () => void; onConfirm: (d: Date) => void; maximumDate?: Date;
}) => {
  const pendingRef = React.useRef<Date>(value);
  const isDark = useColorScheme() === 'dark';
  React.useEffect(() => { if (show) pendingRef.current = value; }, [show]);
  if (!show) return null;
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
        <TouchableOpacity style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} activeOpacity={1} onPress={onClose} />
        <View style={{ backgroundColor: isDark ? '#1e293b' : '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: isDark ? '#334155' : '#e2e8f0' }}>
            <TouchableOpacity onPress={onClose}>
              <Text style={{ color: '#94a3b8', fontSize: 16 }}>Cancel</Text>
            </TouchableOpacity>
            <Text style={{ color: isDark ? '#e2e8f0' : '#1e293b', fontWeight: '700', fontSize: 16 }}>{label}</Text>
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
  const router = useRouter();
  const dispatch = useDispatch<AppDispatch>();
  const { formatCurrency, currency } = useAppSettings();
  const accounts = useSelector((state: any) => state.accounts.items);
  const transactions = useSelector((state: any) => state.transactions.items);
  const budgets = useSelector((state: any) => state.budgets.items);
  const accountsStatus = useSelector((state: any) => state.accounts.status);
  const { categories } = useTransactions();

  const currencySymbol = useMemo(() => {
    return formatCurrency(0).replace(/[\d,.\s]/g, '').trim() || currency;
  }, [currency, formatCurrency]);

  const { edit } = useLocalSearchParams<{ edit?: string }>();

  const isEditing = !!edit;
  const editingTransaction = transactions.find((t: any) => t.id === edit);

  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<'INCOME' | 'EXPENSE'>('EXPENSE');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [note, setNote] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [transactionDate, setTransactionDate] = useState<Date>(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [kbdHeight, setKbdHeight] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, e => setKbdHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(hideEvent, () => setKbdHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  const uniqueTags = useMemo(() => {
    const tagsSet = new Set<string>();
    transactions.forEach((t: any) => {
      if (t.tags && Array.isArray(t.tags)) {
        t.tags.forEach((tag: any) => {
          if (tag && typeof tag === 'string') tagsSet.add(tag.trim().toLowerCase());
        });
      }
    });
    return Array.from(tagsSet).sort();
  }, [transactions]);

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
      setSelectedCategory(editingTransaction.category);
      setNote(editingTransaction.description !== editingTransaction.category ? editingTransaction.description : '');
      setTagsInput(formatTagInput(editingTransaction.tags));
      setTransactionDate(new Date(editingTransaction.date));
    }
  }, [isEditing, editingTransaction]);

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
    if (!amount || isNaN(numericAmount) || numericAmount <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid amount greater than 0.');
      return;
    }
    if (!selectedAccountId) {
      Alert.alert('No Account', 'Please select an account.');
      return;
    }
    if (!selectedCategory) {
      Alert.alert('No Category', 'Please select a category.');
      return;
    }

    const transactionData = {
      account_id: selectedAccountId,
      amount: numericAmount,
      type,
      category: selectedCategory,
      description: note || selectedCategory,
      tags: parseTagInput(tagsInput),
      date: transactionDate.getTime(),
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
    router.back();
  };

  const filteredCategories = categories.filter(c => c.type === type.toLowerCase());

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
            className={`flex-row items-center py-2 px-3 rounded-xl mb-1 border ${
              selectedCategory === category.name
                ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-500'
                : 'bg-slate-50 dark:bg-slate-900 border-transparent'
            }`}
            style={{ marginLeft: indentLeft }}
            onPress={() => setSelectedCategory(category.name)}
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
                <Text className="text-slate-400 text-[10px] mr-1">{children.length}</Text>
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
          <TouchableOpacity onPress={() => router.back()} className="w-9 h-9 bg-white/20 rounded-xl justify-center items-center">
            <FontAwesome name="close" size={16} color="#fff" />
          </TouchableOpacity>
          <Text className="text-white text-lg font-bold">{isEditing ? 'Edit Transaction' : 'Add Transaction'}</Text>
          <TouchableOpacity onPress={handleSave} className="w-9 h-9 bg-secondary-500 rounded-xl justify-center items-center">
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
              onChangeText={setAmount}
              autoFocus
            />
          </View>
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
                <Text className={`ml-1.5 text-xs font-bold ${type === 'EXPENSE' ? 'text-red-500' : 'text-slate-400'}`}>Expense</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              className={`flex-1 py-2.5 rounded-lg items-center ${type === 'INCOME' ? 'bg-white dark:bg-slate-700' : ''}`}
              style={type === 'INCOME' ? { elevation: 2 } : {}}
              onPress={() => setType('INCOME')}
            >
              <View className="flex-row items-center">
                <FontAwesome name="arrow-down" size={13} color={type === 'INCOME' ? '#10b981' : '#94a3b8'} />
                <Text className={`ml-1.5 text-xs font-bold ${type === 'INCOME' ? 'text-green-600' : 'text-slate-400'}`}>Income</Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>

        {/* Account Selection */}
        <View className="bg-white dark:bg-slate-800 rounded-2xl p-3 mb-3 shadow border border-slate-100 dark:border-slate-700" style={{ elevation: 3 }}>
          <Text className="text-slate-900 dark:text-white text-xs font-bold mb-2">Account</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-1">
            {accounts.map((account: any) => (
              <TouchableOpacity
                key={account.id}
                onPress={() => setSelectedAccountId(account.id)}
                className={`mx-1 p-3 rounded-xl border-2 min-w-[90px] items-center ${
                  selectedAccountId === account.id
                    ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-500'
                    : 'bg-slate-50 dark:bg-slate-900 border-transparent'
                }`}
              >
                <View className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-800 justify-center items-center mb-1.5">
                  <FontAwesome
                    name={account.type === 'CASH' ? 'money' : account.type === 'MOBILE_MONEY' ? 'mobile' : 'bank'}
                    size={15}
                    color={selectedAccountId === account.id ? '#6366f1' : '#94a3b8'}
                  />
                </View>
                <Text className="text-slate-900 dark:text-white text-[11px] font-bold mb-0.5" numberOfLines={1}>{account.name}</Text>
                <Text className="text-slate-500 text-[9px]">{formatCurrency(account.balance)}</Text>
              </TouchableOpacity>
            ))}
            {accounts.length === 0 && (
              <TouchableOpacity
                onPress={() => router.replace('/accounts')}
                className="p-3 items-center justify-center bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700"
              >
                <FontAwesome name="plus-circle" size={20} color="#6366f1" />
                <Text className="text-slate-900 dark:text-white font-bold mt-1 text-xs">No Accounts</Text>
                <Text className="text-slate-500 text-[10px] text-center mt-0.5">Tap to create one.</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>

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
              {transactionDate.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}
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
        <View className="bg-white dark:bg-slate-800 rounded-2xl p-3 mb-3 shadow border border-slate-100 dark:border-slate-700" style={{ elevation: 3 }}>
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
                    <Text className={`ml-1.5 text-[9px] font-semibold ${selectedBudgetMetrics.rolloverDelta > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
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
        </View>

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
          <Text className="text-slate-400 text-[10px] mt-1.5">Comma-separated. Great for projects, events, or links.</Text>
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
              <Text className="text-[9px] text-slate-400 font-bold mb-1 uppercase">Suggested Tags</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-1 px-1">
                {uniqueTags.map((tag) => {
                  const currentTags = parseTagInput(tagsInput) || [];
                  const isSelected = currentTags.some(t => t.toLowerCase() === tag.toLowerCase());
                  return (
                    <TouchableOpacity
                      key={tag}
                      onPress={() => handleToggleTag(tag)}
                      className={`mr-1.5 px-2.5 py-1 rounded-full border ${
                        isSelected
                          ? 'bg-indigo-600 border-indigo-600'
                          : 'bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-800'
                      }`}
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
    </KeyboardAvoidingView>
  );
}
