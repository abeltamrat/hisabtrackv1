import { useTransactions } from '@/context/TransactionContext';
import { useAppSettings } from '@/contexts/AppSettingsContext';
import { RootState } from '@/store';
import { deleteBudget, fetchBudgets } from '@/store/slices/budgetsSlice';
import { fetchTransactions } from '@/store/slices/transactionsSlice';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Platform, ScrollView, Text, TouchableOpacity, useColorScheme, View } from 'react-native';

import { useDispatch, useSelector } from 'react-redux';

export default function BudgetScreen() {
  const { formatCurrency } = useAppSettings();
  const colorScheme = useColorScheme();
  const router = useRouter();
  const dispatch = useDispatch();
  const { categories } = useTransactions();
  const { items: budgets } = useSelector((state: RootState) => state.budgets);
  const { items: transactions } = useSelector((state: RootState) => state.transactions);

  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);

  const handleDelete = (id: string) => {
    const doDelete = () => {
      // @ts-ignore
      dispatch(deleteBudget(id));
    };

    if (Platform.OS === 'web') {
      if (confirm('Are you sure you want to delete this budget?')) {
        doDelete();
      }
    } else {
      Alert.alert(
        'Delete Budget',
        'Are you sure you want to delete this budget?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: doDelete,
          },
        ]
      );
    }
  };

  const handleEdit = (budget: any) => {
    router.push({
      pathname: '/budget-modal',
      params: {
        id: budget.id,
        amount: budget.limit_amount.toString(),
        category: budget.category,
      },
    });
  };

  useEffect(() => {
    // @ts-ignore
    dispatch(fetchBudgets());
    // @ts-ignore
    dispatch(fetchTransactions());
  }, [dispatch]);

  // Calculate spent amount for each budget
  const budgetData = budgets.map(budget => {
    const spent = transactions
      .filter(t => {
        const isSameCategory = t.category === budget.category;
        const isExpense = t.type === 'EXPENSE';
        const tDate = new Date(t.date);
        const bStart = new Date(budget.start_date);
        const bEnd = new Date(budget.end_date);
        const isInPeriod = tDate >= bStart && tDate <= bEnd;
        return isSameCategory && isExpense && isInPeriod;
      })
      .reduce((sum, t) => sum + t.amount, 0);

    return {
      ...budget,
      spent,
    };
  });

  // Grouping Logic
  const groupedBudgets = useMemo(() => {
    const groups: Record<string, { items: typeof budgetData, totalLimit: number, totalSpent: number }> = {};

    budgetData.forEach(budget => {
      const category = categories.find(c => c.name === budget.category);
      let groupName = budget.category;

      if (category && category.parentId) {
        const parent = categories.find(c => c.id === category.parentId);
        if (parent) {
          groupName = parent.name;
        }
      }

      if (!groups[groupName]) {
        groups[groupName] = { items: [], totalLimit: 0, totalSpent: 0 };
      }

      groups[groupName].items.push(budget);
      groups[groupName].totalLimit += budget.limit_amount;
      groups[groupName].totalSpent += budget.spent;
    });

    return groups;
  }, [budgetData, categories]);

  const groupNames = Object.keys(groupedBudgets).sort();

  const displayedBudgets = selectedGroup ? groupedBudgets[selectedGroup].items : budgetData;
  const totalBudget = displayedBudgets.reduce((sum, b) => sum + b.limit_amount, 0);
  const totalSpent = displayedBudgets.reduce((sum, b) => sum + b.spent, 0);
  const totalRemaining = totalBudget - totalSpent;
  const totalProgress = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0;

  const getProgress = (spent: number, limit: number) => {
    if (limit === 0) return 0;
    const percentage = (spent / limit) * 100;
    return Math.min(percentage, 100);
  };

  const getProgressColor = (percentage: number) => {
    if (percentage >= 90) return '#ef4444';
    if (percentage >= 70) return '#f59e0b';
    return '#10b981';
  };

  return (
    <View className="flex-1 bg-slate-50 dark:bg-background-dark">
      <StatusBar style="auto" />

      {/* Header */}
      <LinearGradient
        colors={colorScheme === 'dark' ? ['#334155', '#1e293b'] : ['#9333ea', '#7e22ce']}
        className="px-6 pt-6 pb-12 rounded-b-[32px]"
        style={{ elevation: 4 }}
      >
        <View className="flex-row justify-between items-center mb-6">
          <TouchableOpacity onPress={() => selectedGroup ? setSelectedGroup(null) : router.back()} className="w-10 h-10 bg-white/20 rounded-xl justify-center items-center">
            <FontAwesome name="arrow-left" size={18} color="#fff" />
          </TouchableOpacity>
          <Text className="text-white text-xl font-bold">{selectedGroup || 'Budget Management'}</Text>
          <TouchableOpacity onPress={() => router.push('/budget-modal')} className="w-10 h-10 bg-white/20 rounded-xl justify-center items-center">
            <FontAwesome name="plus" size={18} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Summary Card */}
        <View className="bg-white/10 dark:bg-white/5 backdrop-blur-lg rounded-2xl p-5">
          <Text className="text-purple-100 text-sm font-medium mb-2">Total Budget This Month</Text>
          <Text className="text-white text-3xl font-bold mb-4">{formatCurrency(totalBudget)}</Text>
          <View className="flex-row justify-between">
            <View>
              <Text className="text-purple-100 text-xs mb-1">Spent</Text>
              <Text className="text-white text-lg font-bold">{formatCurrency(totalSpent)}</Text>
            </View>
            <View>
              <Text className="text-purple-100 text-xs mb-1">Remaining</Text>
              <Text className="text-white text-lg font-bold">{formatCurrency(totalRemaining)}</Text>
            </View>
            <View>
              <Text className="text-purple-100 text-xs mb-1">Progress</Text>
              <Text className="text-white text-lg font-bold">{totalProgress.toFixed(0)}%</Text>
            </View>
          </View>
        </View>
      </LinearGradient>

      <ScrollView className="flex-1 px-6 -mt-6" showsVerticalScrollIndicator={false}>
        {/* Category Budgets */}
        <View className="mb-6">
          {!selectedGroup ? (
            /* GROUP LIST VIEW */
            <>
              {groupNames.length === 0 ? (
                <View className="bg-white dark:bg-slate-800 rounded-3xl p-8 items-center shadow-lg border border-slate-100 dark:border-slate-700">
                  <Text className="text-slate-500 dark:text-slate-400">No budgets set yet.</Text>
                </View>
              ) : (
                groupNames.map((name) => {
                  const group = groupedBudgets[name];
                  const progress = getProgress(group.totalSpent, group.totalLimit);
                  const progressColor = getProgressColor(progress);
                  // Find parent category icon/color if possible
                  const parentCat = categories.find(c => c.name === name);

                  return (
                    <TouchableOpacity
                      key={name}
                      onPress={() => setSelectedGroup(name)}
                      className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-4 shadow-lg border border-slate-100 dark:border-slate-700"
                      style={{ elevation: 4 }}
                    >
                      <View className="flex-row items-center justify-between mb-4">
                        <View className="flex-row items-center">
                          <View
                            className="w-12 h-12 rounded-2xl justify-center items-center mr-4"
                            style={{ backgroundColor: parentCat?.color ? parentCat.color + '20' : '#f1f5f9' }}
                          >
                            <FontAwesome name={parentCat?.icon as any || 'folder'} size={20} color={parentCat?.color || '#94a3b8'} />
                          </View>
                          <View>
                            <Text className="text-slate-900 dark:text-white font-bold text-lg">{name}</Text>
                            <Text className="text-slate-500 text-sm">{group.items.length} Categories</Text>
                          </View>
                        </View>
                        <FontAwesome name="chevron-right" size={14} color="#94a3b8" />
                      </View>

                      <View className="flex-row justify-between mb-2">
                        <Text className="text-slate-500 text-xs">Total Progress</Text>
                        <Text className="text-slate-900 dark:text-white font-bold">{progress.toFixed(0)}%</Text>
                      </View>

                      <View className="bg-slate-100 dark:bg-slate-900 h-3 rounded-full overflow-hidden mb-3">
                        <View
                          className="h-full rounded-full"
                          style={{
                            width: `${progress}%`,
                            backgroundColor: progressColor,
                          }}
                        />
                      </View>

                      <View className="flex-row justify-between border-t border-slate-100 dark:border-slate-700 pt-3">
                        <View>
                          <Text className="text-slate-500 text-xs">Spent</Text>
                          <Text className="text-slate-900 dark:text-white font-bold">{formatCurrency(group.totalSpent)}</Text>
                        </View>
                        <View className="items-end">
                          <Text className="text-slate-500 text-xs">Limit</Text>
                          <Text className="text-slate-900 dark:text-white font-bold">{formatCurrency(group.totalLimit)}</Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
            </>
          ) : (
            /* BUDGET ITEMS LIST VIEW */
            displayedBudgets.map((budget) => {
              const category = categories.find(c => c.name === budget.category);
              const progress = getProgress(budget.spent, budget.limit_amount);
              const progressColor = getProgressColor(progress);

              return (
                <View
                  key={budget.id}
                  className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-4 shadow-lg border border-slate-100 dark:border-slate-700"
                  style={{ elevation: 4 }}
                >
                  {/* Category Header */}
                  <View className="flex-row items-center mb-4">
                    <View
                      className="w-12 h-12 rounded-2xl justify-center items-center mr-4"
                      style={{ backgroundColor: category?.color ? category.color + '20' : '#f1f5f9' }}
                    >
                      <FontAwesome name={category?.icon as any || 'question'} size={20} color={category?.color || '#94a3b8'} />
                    </View>
                    <View className="flex-1">
                      <Text className="text-slate-900 dark:text-white font-bold text-base">{budget.category}</Text>
                      <Text className="text-slate-500 dark:text-slate-400 text-sm">
                        {formatCurrency(budget.spent)} of {formatCurrency(budget.limit_amount)}
                      </Text>
                    </View>
                    <View className="items-end">
                      <View className="flex-row gap-2 mb-1">
                        <TouchableOpacity onPress={() => handleEdit(budget)} className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                          <FontAwesome name="pencil" size={12} color="#3b82f6" />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => handleDelete(budget.id)} className="p-2 bg-red-50 dark:bg-red-900/20 rounded-lg">
                          <FontAwesome name="trash" size={12} color="#ef4444" />
                        </TouchableOpacity>
                      </View>
                      <Text className="text-slate-900 dark:text-white font-bold text-lg">
                        {progress.toFixed(0)}%
                      </Text>
                      <Text className={`text-xs font-semibold mt-1`} style={{ color: progressColor }}>
                        {formatCurrency(budget.limit_amount - budget.spent)} left
                      </Text>
                    </View>
                  </View>

                  {/* Progress Bar */}
                  <View className="bg-slate-100 dark:bg-slate-900 h-3 rounded-full overflow-hidden">
                    <View
                      className="h-full rounded-full"
                      style={{
                        width: `${progress}%`,
                        backgroundColor: progressColor,
                      }}
                    />
                  </View>

                  {/* Alert if over budget */}
                  {progress >= 90 && (
                    <View className="flex-row items-center mt-3 bg-red-50 dark:bg-red-900/20 p-3 rounded-xl">
                      <FontAwesome name="exclamation-triangle" size={14} color="#ef4444" />
                      <Text className="text-red-600 dark:text-red-400 text-xs font-semibold ml-2">
                        {progress >= 100 ? 'Budget exceeded!' : 'Almost at limit!'}
                      </Text>
                    </View>
                  )}
                </View>
              );
            })
          )}
        </View>

        {/* Add Budget Button */}
        <TouchableOpacity onPress={() => router.push('/budget-modal')} className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-8 shadow-lg border border-slate-100 dark:border-slate-700 flex-row items-center justify-center" style={{ elevation: 4 }}>
          <View className="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 rounded-2xl justify-center items-center mr-4">
            <FontAwesome name="plus" size={20} color="#9333ea" />
          </View>
          <Text className="text-slate-900 dark:text-white font-bold text-base">Add New Budget Category</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}
