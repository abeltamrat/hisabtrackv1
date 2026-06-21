import { useTransactions } from '@/context/TransactionContext';
import CategoryIcon from '@/components/CategoryIcon';
import { useAppSettings } from '@/contexts/AppSettingsContext';
import BudgetService from '@/services/BudgetService';
import { AppDispatch, RootState } from '@/store';
import { addBudget, updateBudget } from '@/store/slices/budgetsSlice';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';

export default function AddBudgetScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { id, amount: initialAmount, category: initialCategory, rolloverMode: initialRolloverMode, period: initialPeriod } = params;
  const isEdit = !!id;

  const dispatch = useDispatch<AppDispatch>();
  const { formatCurrency, currency } = useAppSettings();
  const { categories } = useTransactions();

  const currencySymbol = useMemo(() => {
    return formatCurrency(0).replace(/[\d,.\s]/g, '').trim() || currency;
  }, [currency, formatCurrency]);
  const budgets = useSelector((state: RootState) => state.budgets.items);
  const existingBudget = isEdit ? budgets.find(b => b.id === id?.toString()) : undefined;

  const [amount, setAmount] = useState(initialAmount ? initialAmount.toString() : '');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [period, setPeriod] = useState<'MONTHLY' | 'WEEKLY'>(
    initialPeriod === 'WEEKLY' ? 'WEEKLY' : 'MONTHLY'
  );
  const [rolloverMode, setRolloverMode] = useState<'NONE' | 'CARRY_UNUSED' | 'REDUCE_NEXT'>(
    initialRolloverMode === 'CARRY_UNUSED' || initialRolloverMode === 'REDUCE_NEXT'
      ? initialRolloverMode
      : 'NONE'
  );

  const expenseCategories = useMemo(
    () => categories.filter((c) => (c.type || '').toString().toLowerCase() === 'expense'),
    [categories]
  );
  const expenseCategoryNames = useMemo(
    () => new Set(expenseCategories.map((category) => category.name)),
    [expenseCategories]
  );

  // Organize into hierarchy
  const rootCategories = expenseCategories.filter(c => !c.parentId);
  const getChildCategories = (parentId: string) => expenseCategories.filter(c => c.parentId === parentId);

  useEffect(() => {
    const initial = initialCategory ? initialCategory.toString() : '';
    if (initial && expenseCategoryNames.has(initial)) {
      setSelectedCategory(initial);
      return;
    }
    if (!expenseCategoryNames.has(selectedCategory) && expenseCategories.length > 0) {
      setSelectedCategory(expenseCategories[0].name);
    }
  }, [expenseCategories, expenseCategoryNames, initialCategory, selectedCategory]);

  const handleSave = async () => {
    const numericAmount = parseFloat(amount);
    if (!amount || isNaN(numericAmount) || numericAmount <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid amount greater than zero.');
      return;
    }
    if (!selectedCategory || !expenseCategoryNames.has(selectedCategory)) {
      Alert.alert(
        'Select Expense Category',
        'Please choose a valid expense category for this budget.'
      );
      return;
    }

    const periodRange = BudgetService.getCurrentPeriodRange(period);

    const budgetData = {
      category: selectedCategory,
      limit_amount: numericAmount,
      base_limit_amount: numericAmount,
      rollover_mode: rolloverMode,
      period,
      start_date: periodRange.start,
      end_date: periodRange.end,
    };

    if (isEdit) {
      const result = await dispatch(updateBudget({
        ...(existingBudget ?? {}),
        ...budgetData,
        id: id.toString(),
      } as any));
      if (updateBudget.rejected.match(result)) {
        Alert.alert('Error', 'Failed to update budget.');
        return;
      }
    } else {
      const result = await dispatch(addBudget(budgetData));
      if (addBudget.rejected.match(result)) {
        Alert.alert('Error', 'Failed to save budget.');
        return;
      }
    }
    router.back();
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}
      enabled={Platform.OS !== 'web'}
      className="flex-1 bg-slate-50 dark:bg-background-dark"
    >
      <StatusBar style={Platform.OS === 'ios' ? 'light' : 'auto'} />

      {/* Header */}
      <LinearGradient
        colors={['#9333ea', '#7e22ce']}
        className="px-6 pt-16 pb-8 rounded-b-[32px]"
        style={{ elevation: 4 }}
      >
        <View className="flex-row justify-between items-center mb-6">
          <TouchableOpacity onPress={() => router.back()} className="w-10 h-10 bg-white/20 rounded-xl justify-center items-center">
            <FontAwesome name="close" size={18} color="#fff" />
          </TouchableOpacity>
          <Text className="text-white text-xl font-bold">{isEdit ? 'Edit Budget' : 'Set Budget'}</Text>
          <TouchableOpacity onPress={handleSave} className="w-10 h-10 bg-secondary-500 rounded-xl justify-center items-center">
            <FontAwesome name="check" size={18} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Amount Input */}
        <View className="items-center mb-6">
          <Text className="text-purple-100 text-sm mb-2">{period === 'WEEKLY' ? 'Weekly Limit' : 'Monthly Limit'}</Text>
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

      <ScrollView className="flex-1 px-6 -mt-6" showsVerticalScrollIndicator={false}>
        {expenseCategories.length === 0 && (
          <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-slate-100 dark:border-slate-700" style={{ elevation: 4 }}>
            <Text className="text-slate-900 dark:text-white text-base font-bold mb-2">No Expense Categories</Text>
            <Text className="text-slate-500 dark:text-slate-400 text-sm">
              Create at least one expense category before adding a budget.
            </Text>
          </View>
        )}

        {/* Category Selection */}
        <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-slate-100 dark:border-slate-700" style={{ elevation: 4 }}>
          <Text className="text-slate-900 dark:text-white text-base font-bold mb-4">Category</Text>
          <View className="pb-4">
            {rootCategories.map((category) => (
              <View key={category.id} className="mb-4">
                {/* Parent Category */}
                <TouchableOpacity
                  className={`w-full items-center p-4 rounded-2xl mb-2 border-2 ${selectedCategory === category.name
                      ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-500'
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
                      <FontAwesome name="check" size={16} color="#9333ea" />
                    )}
                  </View>
                </TouchableOpacity>

                {/* Child Categories */}
                {getChildCategories(category.id).map((childCategory) => (
                  <TouchableOpacity
                    key={childCategory.id}
                    className={`w-full items-center p-3 rounded-xl ml-8 mb-2 border-2 ${selectedCategory === childCategory.name
                        ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-500'
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
                        <FontAwesome name="check" size={12} color="#9333ea" />
                      )}
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            ))}
          </View>
        </View>

        {/* Period */}
        <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-slate-100 dark:border-slate-700" style={{ elevation: 4 }}>
          <Text className="text-slate-900 dark:text-white text-base font-bold mb-4">Budget Period</Text>
          <View className="flex-row gap-3">
            {(['MONTHLY', 'WEEKLY'] as const).map((p) => (
              <TouchableOpacity
                key={p}
                onPress={() => setPeriod(p)}
                className={`flex-1 p-4 rounded-2xl border-2 items-center ${
                  period === p
                    ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-500'
                    : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700'
                }`}
              >
                <Text className={`font-bold text-sm ${period === p ? 'text-purple-700 dark:text-purple-300' : 'text-slate-700 dark:text-slate-300'}`}>
                  {p === 'MONTHLY' ? 'Monthly' : 'Weekly'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-8 shadow-lg border border-slate-100 dark:border-slate-700" style={{ elevation: 4 }}>
          <Text className="text-slate-900 dark:text-white text-base font-bold mb-2">Rollover Rule</Text>
          <Text className="text-slate-500 dark:text-slate-400 text-sm mb-4">
            Control how the previous period affects this budget when you create the next cycle.
          </Text>

          {[
            {
              value: 'NONE' as const,
              title: 'No rollover',
              description: 'Start each new period with the base amount only.',
            },
            {
              value: 'CARRY_UNUSED' as const,
              title: 'Carry unused forward',
              description: 'Unused budget from the previous period increases this limit.',
            },
            {
              value: 'REDUCE_NEXT' as const,
              title: 'Reduce after overspend',
              description: 'Overspending in the previous period lowers this limit.',
            },
          ].map((option) => (
            <TouchableOpacity
              key={option.value}
              onPress={() => setRolloverMode(option.value)}
              className={`rounded-2xl border p-4 mb-3 ${
                rolloverMode === option.value
                  ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-500'
                  : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700'
              }`}
            >
              <View className="flex-row justify-between items-center mb-1">
                <Text className="text-slate-900 dark:text-white font-bold">{option.title}</Text>
                {rolloverMode === option.value && (
                  <FontAwesome name="check-circle" size={18} color="#9333ea" />
                )}
              </View>
              <Text className="text-slate-500 dark:text-slate-400 text-sm">{option.description}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
