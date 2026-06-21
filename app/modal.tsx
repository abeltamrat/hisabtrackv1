import { useTransactions } from '@/context/TransactionContext';
import CategoryIcon from '@/components/CategoryIcon';
import { useAppSettings } from '@/contexts/AppSettingsContext';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, Text, TextInput, TouchableOpacity, View, useColorScheme } from 'react-native';

import { AppDispatch } from '@/store';
import BudgetService from '@/services/BudgetService';
import { fetchAccounts } from '@/store/slices/accountsSlice';
import { addTransaction, updateTransaction } from '@/store/slices/transactionsSlice';
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

  // Robust parameter handling for expo-router versions
  const Router = require('expo-router');
  const useParamsHook = (Router as any).useLocalSearchParams ?? (Router as any).useSearchParams ?? (() => ({}));
  const { edit } = useParamsHook() as { edit?: string };

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

  // Ensure accounts and budgets are loaded
  useEffect(() => {
    if (accounts.length === 0) {
      dispatch(fetchAccounts());
    }
    if (budgets.length === 0) {
      // @ts-ignore
      dispatch(fetchBudgets());
    }
  }, [dispatch, accounts.length, budgets.length]);

  // Load transaction data for editing
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
        // Use timeout to let UI render first
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

    // Check budget if it's an expense (non-blocking — just notify)
    if (type === 'EXPENSE') {
      const budget = budgets.find((b: any) => b.category === selectedCategory);
      if (budget) {
        const metrics = BudgetService.calculateBudgetMetrics(
          budget,
          budgets,
          transactions,
          isEditing ? { excludeTransactionId: edit } : undefined
        );

        const newTotal = metrics.spent + numericAmount;
        const limit = metrics.effectiveLimit;
        const percentage = limit > 0 ? newTotal / limit : 0;

        if (newTotal > limit) {
          const message = `You've exceeded your ${selectedCategory} budget by ${formatCurrency(newTotal - limit)}!`;
          await NotificationService.showImmediateNotification('Budget Exceeded', message, {
            actionType: 'view_budget',
            inAppType: 'alert',
            icon: 'exclamation-circle',
            color: '#ef4444',
            channelId: 'finance_alerts',
          });
        } else if (percentage >= 0.9) {
          const message = `You're at ${(percentage * 100).toFixed(0)}% of your ${selectedCategory} budget.`;
          await NotificationService.showImmediateNotification('Budget Alert', message, {
            actionType: 'view_budget',
            inAppType: 'warning',
            icon: 'exclamation-triangle',
            color: '#f59e0b',
            channelId: 'finance_alerts',
          });
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

  // Organize categories into hierarchy
  const rootCategories = filteredCategories.filter(c => !c.parentId);
  const getChildCategories = (parentId: string) => filteredCategories.filter(c => c.parentId === parentId);

  // Flatten categories for selection (include both parents and children)
  const allSelectableCategories = filteredCategories;

  // Set default category when categories change
  useEffect(() => {
    if (!selectedCategory && allSelectableCategories.length > 0) {
      setSelectedCategory(allSelectableCategories[0].name);
    }
  }, [allSelectableCategories, selectedCategory]);

  const selectedBudgetMetrics = useMemo(() => {
    if (type !== 'EXPENSE' || !selectedCategory) {
      return null;
    }

    const budget = budgets.find((item: any) => item.category === selectedCategory);
    if (!budget) {
      return null;
    }

    return BudgetService.calculateBudgetMetrics(
      budget,
      budgets,
      transactions,
      isEditing ? { excludeTransactionId: edit } : undefined
    );
  }, [budgets, edit, isEditing, selectedCategory, transactions, type]);

  const parsedTags = useMemo(() => parseTagInput(tagsInput) || [], [tagsInput]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}
      enabled={Platform.OS !== 'web'}
      className="flex-1 bg-slate-50 dark:bg-background-dark"
    >
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style={Platform.OS === 'ios' ? 'light' : 'auto'} />

      {/* Header */}
      <LinearGradient
        colors={['#4f46e5', '#4338ca']}
        className="px-6 pt-16 pb-8 rounded-b-[32px]"
        style={{ elevation: 4 }}
      >
        <View className="flex-row justify-between items-center mb-6">
          <TouchableOpacity onPress={() => router.back()} className="w-10 h-10 bg-white/20 rounded-xl justify-center items-center">
            <FontAwesome name="close" size={18} color="#fff" />
          </TouchableOpacity>
          <Text className="text-white text-xl font-bold">{isEditing ? 'Edit Transaction' : 'Add Transaction'}</Text>
          <TouchableOpacity onPress={handleSave} className="w-10 h-10 bg-secondary-500 rounded-xl justify-center items-center">
            <FontAwesome name="check" size={18} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Amount Input */}
        <View className="items-center mb-6">
          <Text className="text-primary-100 text-sm mb-2">How much?</Text>
          <View className="flex-row items-center">
            <Text className="text-white text-5xl font-bold mr-2">{currencySymbol}</Text>
            <TextInput
              className="text-white text-6xl font-bold min-w-[150px] text-center"
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

      <ScrollView className="flex-1 px-6 -mt-6" showsVerticalScrollIndicator={false} nestedScrollEnabled={true}>
        {/* Type Selector Card */}
        <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-slate-100 dark:border-slate-700" style={{ elevation: 4 }}>
          <Text className="text-slate-900 dark:text-white text-base font-bold mb-4">Transaction Type</Text>
          <View className="flex-row bg-slate-50 dark:bg-slate-900 p-1.5 rounded-2xl">
            <TouchableOpacity
              className={`flex-1 py-4 rounded-xl items-center ${type === 'EXPENSE' ? 'bg-white dark:bg-slate-700' : ''}`}
              style={type === 'EXPENSE' ? { elevation: 2 } : {}}
              onPress={() => setType('EXPENSE')}
            >
              <View className="flex-row items-center">
                <FontAwesome name="arrow-up" size={16} color={type === 'EXPENSE' ? '#ef4444' : '#94a3b8'} />
                <Text className={`ml-2 text-sm font-bold ${type === 'EXPENSE' ? 'text-red-500' : 'text-slate-400'}`}>Expense</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              className={`flex-1 py-4 rounded-xl items-center ${type === 'INCOME' ? 'bg-white dark:bg-slate-700' : ''}`}
              style={type === 'INCOME' ? { elevation: 2 } : {}}
              onPress={() => setType('INCOME')}
            >
              <View className="flex-row items-center">
                <FontAwesome name="arrow-down" size={16} color={type === 'INCOME' ? '#10b981' : '#94a3b8'} />
                <Text className={`ml-2 text-sm font-bold ${type === 'INCOME' ? 'text-green-600' : 'text-slate-400'}`}>Income</Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>

        {/* Account Selection */}
        <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-slate-100 dark:border-slate-700" style={{ elevation: 4 }}>
          <Text className="text-slate-900 dark:text-white text-base font-bold mb-4">Account</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-2">
            {accounts.map((account: any) => (
              <TouchableOpacity
                key={account.id}
                onPress={() => setSelectedAccountId(account.id)}
                className={`mx-2 p-4 rounded-2xl border-2 min-w-[120px] items-center ${selectedAccountId === account.id
                  ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-500'
                  : 'bg-slate-50 dark:bg-slate-900 border-transparent'
                  }`}
              >
                <View className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-800 justify-center items-center mb-2">
                  <FontAwesome
                    name={account.type === 'CASH' ? 'money' : account.type === 'MOBILE_MONEY' ? 'mobile' : 'bank'}
                    size={18}
                    color={selectedAccountId === account.id ? '#6366f1' : '#94a3b8'}
                  />
                </View>
                <Text className="text-slate-900 dark:text-white text-xs font-bold mb-1">{account.name}</Text>
                <Text className="text-slate-500 text-[10px]">{formatCurrency(account.balance)}</Text>
              </TouchableOpacity>
            ))}
            {accounts.length === 0 && (
              <TouchableOpacity
                onPress={() => router.replace('/accounts')}
                className="p-4 items-center justify-center bg-slate-50 dark:bg-slate-900 rounded-xl mt-2 border border-slate-200 dark:border-slate-700 dashed"
              >
                <FontAwesome name="plus-circle" size={24} color="#6366f1" />
                <Text className="text-slate-900 dark:text-white font-bold mt-2">No Accounts Found</Text>
                <Text className="text-slate-500 text-xs text-center mt-1">
                  You need an account to track transactions.{'\n'}Tap here to create one.
                </Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>

        {/* Date Picker */}
        <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-slate-100 dark:border-slate-700" style={{ elevation: 4 }}>
          <Text className="text-slate-900 dark:text-white text-base font-bold mb-4">Date</Text>
          <TouchableOpacity
            onPress={() => {
              if (Platform.OS === 'android') {
                DateTimePickerAndroid.open({
                  value: transactionDate,
                  mode: 'date',
                  display: 'default',
                  maximumDate: new Date(),
                  onChange: (event: any, selectedDate?: Date) => {
                    if (event.type === 'set' && selectedDate) {
                      setTransactionDate(selectedDate);
                    }
                  },
                });
              } else {
                setShowDatePicker(true);
              }
            }}
            className="flex-row items-center bg-slate-50 dark:bg-slate-900 p-4 rounded-2xl"
          >
            <FontAwesome name="calendar" size={18} color="#6366f1" />
            <Text className="text-slate-900 dark:text-white text-base font-medium ml-3">
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
        <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-slate-100 dark:border-slate-700" style={{ elevation: 4 }}>
          <View className="flex-row justify-between items-center mb-4">
            <Text className="text-slate-900 dark:text-white text-base font-bold">Category</Text>
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
                  <Text className={`text-xs font-medium mr-2 ${isOver ? 'text-red-500' : percent > 90 ? 'text-amber-500' : 'text-slate-500'}`}>
                    {percent.toFixed(0)}% used
                  </Text>
                  <View className="w-16 h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                    <View
                      className={`h-full rounded-full ${isOver ? 'bg-red-500' : percent > 90 ? 'bg-amber-500' : 'bg-green-500'}`}
                      style={{ width: `${percent}%` }}
                    />
                  </View>
                  {selectedBudgetMetrics.rolloverDelta !== 0 && (
                    <Text className={`ml-2 text-[10px] font-semibold ${selectedBudgetMetrics.rolloverDelta > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {selectedBudgetMetrics.rolloverDelta > 0 ? '+' : ''}
                      {selectedBudgetMetrics.rolloverDelta.toFixed(0)}
                    </Text>
                  )}
                </View>
              );
            })()}
          </View>
          <ScrollView showsVerticalScrollIndicator={false} className="max-h-60" nestedScrollEnabled={true}>
            {rootCategories.map((category) => (
              <View key={category.id} className="mb-4">
                {/* Parent Category */}
                <TouchableOpacity
                  className={`w-full items-center p-4 rounded-2xl mb-2 border-2 ${selectedCategory === category.name
                    ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-500'
                    : 'bg-slate-50 dark:bg-slate-900 border-transparent'
                    }`}
                  onPress={() => setSelectedCategory(category.name)}
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
                    {selectedCategory === category.name && (
                      <FontAwesome name="check" size={16} color="#6366f1" />
                    )}
                  </View>
                </TouchableOpacity>

                {/* Child Categories */}
                {getChildCategories(category.id).map((childCategory) => (
                  <TouchableOpacity
                    key={childCategory.id}
                    className={`w-full items-center p-3 rounded-xl ml-8 mb-2 border-2 ${selectedCategory === childCategory.name
                      ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-500'
                      : 'bg-slate-100 dark:bg-slate-700 border-transparent'
                      }`}
                    onPress={() => setSelectedCategory(childCategory.name)}
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
                      {selectedCategory === childCategory.name && (
                        <FontAwesome name="check" size={12} color="#6366f1" />
                      )}
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            ))}
          </ScrollView>
        </View>

        {/* Note Input */}
        <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-slate-100 dark:border-slate-700" style={{ elevation: 4 }}>
          <Text className="text-slate-900 dark:text-white text-base font-bold mb-4">Tags (Optional)</Text>
          <View className="bg-slate-50 dark:bg-slate-900 p-4 rounded-2xl">
            <TextInput
              className="text-slate-900 dark:text-white text-base"
              placeholder="project-alpha, wedding, https://payment.link"
              placeholderTextColor="#94a3b8"
              value={tagsInput}
              onChangeText={setTagsInput}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <Text className="text-slate-400 text-xs mt-2">Use comma-separated tags. Great for projects, events, or links.</Text>
          {parsedTags.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-3 -mx-1 px-1">
              {parsedTags.map((tag) => (
                <View key={tag} className="mr-2 px-3 py-1.5 rounded-full bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800">
                  <Text className="text-indigo-700 dark:text-indigo-300 text-xs font-semibold">#{tag}</Text>
                </View>
              ))}
            </ScrollView>
          )}
        </View>

        {/* Note Input */}
        <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-8 shadow-lg border border-slate-100 dark:border-slate-700" style={{ elevation: 4 }}>
          <Text className="text-slate-900 dark:text-white text-base font-bold mb-4">Note (Optional)</Text>
          <View className="bg-slate-50 dark:bg-slate-900 p-4 rounded-2xl">
            <TextInput
              className="text-slate-900 dark:text-white text-base min-h-[80px]"
              placeholder="Add a note about this transaction..."
              placeholderTextColor="#94a3b8"
              value={note}
              onChangeText={setNote}
              multiline
              textAlignVertical="top"
            />
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
