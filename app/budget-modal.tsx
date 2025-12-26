import { useTransactions } from '@/context/TransactionContext';
import { AppDispatch } from '@/store';
import { addBudget, updateBudget } from '@/store/slices/budgetsSlice';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useDispatch } from 'react-redux';

export default function AddBudgetScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { id, amount: initialAmount, category: initialCategory } = params;
  const isEdit = !!id;

  const dispatch = useDispatch<AppDispatch>();
  const { categories } = useTransactions();
  const [amount, setAmount] = useState(initialAmount ? initialAmount.toString() : '');
  const [selectedCategory, setSelectedCategory] = useState<string>('');

  const expenseCategories = useMemo(
    () => categories.filter((c) => (c.type || '').toString().toUpperCase() === 'EXPENSE'),
    [categories]
  );

  // Organize into hierarchy
  const rootCategories = expenseCategories.filter(c => !c.parentId);
  const getChildCategories = (parentId: string) => expenseCategories.filter(c => c.parentId === parentId);

  useEffect(() => {
    const initial = initialCategory ? initialCategory.toString() : '';
    if (initial) {
      setSelectedCategory(initial);
      return;
    }
    if (!selectedCategory && expenseCategories.length > 0) {
      setSelectedCategory(expenseCategories[0].name);
    }
  }, [expenseCategories, initialCategory, selectedCategory]);

  const handleSave = () => {
    if (!amount) return;

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const budgetData = {
      category: selectedCategory,
      limit_amount: parseFloat(amount),
      period: 'MONTHLY' as const,
      start_date: startOfMonth.getTime(),
      end_date: endOfMonth.getTime(),
    };

    if (isEdit) {
      dispatch(updateBudget({
        ...budgetData,
        id: id.toString(),
      }));
    } else {
      dispatch(addBudget(budgetData));
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
          <Text className="text-purple-100 text-sm mb-2">Monthly Limit</Text>
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

      <ScrollView className="flex-1 px-6 -mt-6" showsVerticalScrollIndicator={false}>
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
                      <FontAwesome name={category.icon as any} size={18} color={category.color} />
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
                        <FontAwesome name={childCategory.icon as any} size={14} color={childCategory.color} />
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
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
