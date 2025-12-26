import { useTransactions } from '@/context/TransactionContext';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { AppDispatch } from '@/store';
import { fetchAccounts } from '@/store/slices/accountsSlice';
import { addTransaction, updateTransaction } from '@/store/slices/transactionsSlice';
import { fetchBudgets } from '@/store/slices/budgetsSlice';
import { AppNotificationService } from '@/services/AppNotificationService';
import { NotificationService } from '@/services/NotificationService';
import { useDispatch, useSelector } from 'react-redux';

export default function AddTransactionScreen() {
  const router = useRouter();
  const dispatch = useDispatch<AppDispatch>();
  const accounts = useSelector((state: any) => state.accounts.items);
  const transactions = useSelector((state: any) => state.transactions.items);
  const budgets = useSelector((state: any) => state.budgets.items);
  const accountsStatus = useSelector((state: any) => state.accounts.status);
  const { categories } = useTransactions();

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
    if (!amount) return;
    if (!selectedAccountId) {
      if (accounts.length > 0) setSelectedAccountId(accounts[0].id);
      return;
    }

    const numericAmount = parseFloat(amount);
    const transactionData = {
      account_id: selectedAccountId,
      amount: numericAmount,
      type: type, // 'INCOME' | 'EXPENSE'
      category: selectedCategory,
      description: note || selectedCategory,
      date: isEditing ? editingTransaction.date : Date.now(),
    };

    // Check budget if it's an expense
    if (type === 'EXPENSE') {
      const budget = budgets.find((b: any) => b.category === selectedCategory);
      if (budget) {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getTime();

        const currentSpent = transactions
          .filter((t: any) =>
            t.type === 'EXPENSE' &&
            t.category === selectedCategory &&
            t.date >= startOfMonth &&
            t.date <= endOfMonth &&
            (isEditing ? t.id !== edit : true) // Exclude current transaction if editing
          )
          .reduce((sum: number, t: any) => sum + t.amount, 0);

        const newTotal = currentSpent + numericAmount;
        const limit = budget.limit_amount;
        const percentage = newTotal / limit;

        if (newTotal > limit) {
          const message = `You've exceeded your ${selectedCategory} budget by $${(newTotal - limit).toFixed(0)}!`;
          await NotificationService.showImmediateNotification('🚨 Budget Exceeded', message);
          await AppNotificationService.addNotification({
            title: '🚨 Budget Exceeded',
            message,
            type: 'alert',
            icon: 'exclamation-circle',
            color: '#ef4444',
            actionType: 'view_budget'
          });
        } else if (percentage >= 0.9) {
          const message = `You're at ${(percentage * 100).toFixed(0)}% of your ${selectedCategory} budget.`;
          await NotificationService.showImmediateNotification('⚠️ Budget Alert', message);
          await AppNotificationService.addNotification({
            title: '⚠️ Budget Alert',
            message,
            type: 'warning',
            icon: 'exclamation-triangle',
            color: '#f59e0b',
            actionType: 'view_budget'
          });
        }
      }
    }

    if (isEditing) {
      dispatch(updateTransaction({ id: edit, ...transactionData }));
    } else {
      dispatch(addTransaction(transactionData));
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
            <Text className="text-white text-5xl font-bold mr-2">$</Text>
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
                <Text className="text-slate-500 text-[10px]">{account.currency} {account.balance}</Text>
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

        {/* Category Selection */}
        <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-slate-100 dark:border-slate-700" style={{ elevation: 4 }}>
          <View className="flex-row justify-between items-center mb-4">
            <Text className="text-slate-900 dark:text-white text-base font-bold">Category</Text>
            {(() => {
              if (type !== 'EXPENSE' || !selectedCategory) return null;
              const budget = budgets.find((b: any) => b.category === selectedCategory);
              if (!budget) return null;

              const now = new Date();
              const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
              const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getTime();

              const currentSpent = transactions
                .filter((t: any) =>
                  t.type === 'EXPENSE' &&
                  t.category === selectedCategory &&
                  t.date >= startOfMonth &&
                  t.date <= endOfMonth &&
                  (isEditing ? t.id !== edit : true)
                )
                .reduce((sum: number, t: any) => sum + t.amount, 0);

              const currentAmount = parseFloat(amount) || 0;
              const total = currentSpent + currentAmount;
              const percent = Math.min((total / budget.limit_amount) * 100, 100);
              const isOver = total > budget.limit_amount;

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
                      <FontAwesome name={category.icon as any} size={18} color={category.color} />
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
                        <FontAwesome name={childCategory.icon as any} size={14} color={childCategory.color} />
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
