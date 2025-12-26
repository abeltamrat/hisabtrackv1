import { BUNDLED_LOGOS } from '@/assets/bankLogos/et';
import { useTransactions } from '@/context/TransactionContext';
import { useAppSettings } from '@/contexts/AppSettingsContext';
import { useI18n } from '@/contexts/I18nContext';
import { RootState } from '@/store';
import { fetchTransactions } from '@/store/slices/transactionsSlice';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Image, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { useDispatch, useSelector } from 'react-redux';

export default function TransactionsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { type } = params;
  const dispatch = useDispatch();
  const { items: transactions, loading } = useSelector((state: RootState) => state.transactions);
  const accounts = useSelector((state: RootState) => state.accounts.items);
  const { categories } = useTransactions();
  const { t } = useI18n();
  const { formatCurrency, fontSize } = useAppSettings();
  const headerTitleSize = fontSize === 'Small' ? 'text-xl' : fontSize === 'Large' ? 'text-3xl' : 'text-2xl';
  const labelSize = fontSize === 'Small' ? 'text-xs' : fontSize === 'Large' ? 'text-base' : 'text-sm';
  const [filter, setFilter] = useState<'ALL' | 'INCOME' | 'EXPENSE'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // Organize categories hierarchically
  const filteredCategories = categories.filter(c => filter === 'ALL' || c.type === filter.toLowerCase());
  const rootCategories = filteredCategories.filter(c => !c.parentId);
  const getChildCategories = (parentId: string) => filteredCategories.filter(c => c.parentId === parentId);

  // Get all category names that should be included when a category is selected
  const getCategoryNamesToInclude = (selectedCatName: string | null) => {
    if (!selectedCatName) return null; // null means include all categories

    const selectedCat = categories.find(c => c.name === selectedCatName);
    if (!selectedCat) return [selectedCatName]; // fallback

    // If it's a parent category (no parentId), include parent + all children
    if (!selectedCat.parentId) {
      const childCategories = getChildCategories(selectedCat.id);
      return [selectedCat.name, ...childCategories.map(c => c.name)];
    }

    // If it's a child category, only include that specific category
    return [selectedCat.name];
  };

  useEffect(() => {
    // @ts-ignore
    dispatch(fetchTransactions());
  }, [dispatch]);

  useEffect(() => {
    if (type && (type === 'INCOME' || type === 'EXPENSE')) {
      setFilter(type);
    }
  }, [type]);

  const filteredTransactions = useMemo(() => {
    const categoriesToInclude = getCategoryNamesToInclude(selectedCategory);

    return transactions.filter((t) => {
      // Type filter
      if (filter !== 'ALL' && t.type !== filter) return false;

      // Category filter
      if (categoriesToInclude && !categoriesToInclude.includes(t.category)) return false;

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          t.description.toLowerCase().includes(query) ||
          t.category.toLowerCase().includes(query)
        );
      }

      return true;
    });
  }, [transactions, filter, selectedCategory, searchQuery, categories]);

  // Group by date
  const groupedTransactions = useMemo(() => {
    const groups: { [key: string]: typeof transactions } = {};

    filteredTransactions.forEach(transaction => {
      const date = new Date(transaction.date);
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      let dateKey: string;
      if (date.toDateString() === today.toDateString()) {
        dateKey = 'Today';
      } else if (date.toDateString() === yesterday.toDateString()) {
        dateKey = 'Yesterday';
      } else {
        dateKey = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }

      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(transaction);
    });

    return Object.entries(groups).map(([date, items]) => ({ date, items }));
  }, [filteredTransactions]);

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  const calculateTotals = () => {
    const income = filteredTransactions
      .filter(t => t.type === 'INCOME')
      .reduce((sum, t) => sum + t.amount, 0);
    const expense = filteredTransactions
      .filter(t => t.type === 'EXPENSE')
      .reduce((sum, t) => sum + t.amount, 0);
    return { income, expense };
  };

  const totals = calculateTotals();

  // Helper to resolve logo source
  const getAccountImageSource = (logoUrl: string | null | undefined) => {
    if (!logoUrl) return undefined;
    const bundled = BUNDLED_LOGOS.find(b => b.url === logoUrl);
    if (bundled && bundled.src) {
      if (typeof bundled.src === 'number') return bundled.src;
      if (typeof bundled.src === 'string') return { uri: bundled.src };
      if (typeof bundled.src === 'object') {
        // @ts-ignore
        if (bundled.src.uri) return bundled.src;
        // @ts-ignore
        if (bundled.src.default) return { uri: bundled.src.default };
        return bundled.src;
      }
    }
    return { uri: logoUrl };
  };

  return (
    <View className="flex-1 bg-slate-50 dark:bg-background-dark">
      <StatusBar style="auto" />

      {/* Header */}
      <View className="px-6 pt-4 pb-2">
        <View className="flex-row justify-between items-center mb-6">
          <Text className={`text-slate-900 dark:text-white ${headerTitleSize} font-bold`}>{t('transactions')}</Text>
          <TouchableOpacity className="w-10 h-10 bg-white dark:bg-slate-800 rounded-xl justify-center items-center shadow-sm border border-slate-100 dark:border-slate-700">
            <FontAwesome name="sliders" size={18} color="#64748b" />
          </TouchableOpacity>
        </View>

        {/* Search Bar */}
        <View className="flex-row items-center bg-white dark:bg-slate-800 rounded-2xl px-4 h-12 mb-4 shadow-sm border border-slate-100 dark:border-slate-700">
          <FontAwesome name="search" size={16} color="#94a3b8" />
          <TextInput
            className="flex-1 text-slate-900 dark:text-white text-base ml-3"
            placeholder={t('searchTransactions')}
            placeholderTextColor="#94a3b8"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <FontAwesome name="times-circle" size={16} color="#94a3b8" />
            </TouchableOpacity>
          )}
        </View>

        {/* Type Filters */}
        <View className="flex-row mb-4 bg-white dark:bg-slate-800 p-1.5 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700">
          {(['ALL', 'INCOME', 'EXPENSE'] as const).map((f) => (
            <TouchableOpacity
              key={f}
              onPress={() => setFilter(f)}
              className="flex-1 rounded-xl"
              style={filter === f ? { elevation: 2 } : {}}
            >
              {filter === f ? (
                <LinearGradient
                  colors={['#6366f1', '#4f46e5']}
                  className="py-3 rounded-xl items-center w-full"
                >
                  <Text className="text-sm font-bold capitalize text-white">
                    {f.toLowerCase()}
                  </Text>
                </LinearGradient>
              ) : (
                <View className="py-3 items-center w-full">
                  <Text className="text-sm font-bold capitalize text-slate-500 dark:text-slate-400">
                    {f.toLowerCase()}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>

        {/* Category Filters */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-6 px-6 mb-4">
          <TouchableOpacity
            onPress={() => setSelectedCategory(null)}
            className={`mr-3 px-4 py-2 rounded-full border-2 ${selectedCategory === null
              ? 'bg-primary-500 border-primary-500'
              : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
              }`}
          >
            <Text className={`text-sm font-bold ${selectedCategory === null ? 'text-white' : 'text-slate-700 dark:text-slate-300'}`}>
              All
            </Text>
          </TouchableOpacity>
          {rootCategories.map((category) => {
            const isParentSelected = selectedCategory === category.name;
            const childCategories = getChildCategories(category.id);

            return (
              <View key={category.id} className="flex-col mr-3">
                {/* Parent Category */}
                <TouchableOpacity
                  onPress={() => setSelectedCategory(category.name)}
                  className={`px-4 py-2 rounded-full border-2 flex-row items-center mb-2 ${isParentSelected
                    ? 'border-primary-500'
                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                    }`}
                  style={isParentSelected ? { backgroundColor: category.color + '20', borderColor: category.color } : {}}
                >
                  <FontAwesome name={category.icon as any} size={12} color={isParentSelected ? category.color : '#64748b'} />
                  <Text className={`text-sm font-bold ml-2 ${isParentSelected ? 'text-slate-900 dark:text-white' : 'text-slate-700 dark:text-slate-300'}`}>
                    {category.name}
                  </Text>
                </TouchableOpacity>

                {/* Child Categories - Show only when parent is selected */}
                {isParentSelected && childCategories.length > 0 && (
                  <View className="flex-row flex-wrap">
                    {childCategories.map((childCat) => (
                      <TouchableOpacity
                        key={childCat.id}
                        onPress={() => setSelectedCategory(childCat.name)}
                        className={`mr-2 mb-1 px-3 py-1.5 rounded-full border flex-row items-center ${selectedCategory === childCat.name
                          ? 'border-primary-500'
                          : 'bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600'
                          }`}
                        style={selectedCategory === childCat.name ? { backgroundColor: childCat.color + '20', borderColor: childCat.color } : {}}
                      >
                        <FontAwesome name={childCat.icon as any} size={10} color={selectedCategory === childCat.name ? childCat.color : '#64748b'} />
                        <Text className={`text-xs font-semibold ml-1 ${selectedCategory === childCat.name ? 'text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-400'}`}>
                          {childCat.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>

        {/* Summary */}
        <View className="flex-row bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-100 dark:border-slate-700">
          <View className="flex-1">
            <Text className="text-slate-500 dark:text-slate-400 text-xs mb-1">{t('income')}</Text>
            <Text className="text-green-600 text-lg font-bold">{formatCurrency(totals.income)}</Text>
          </View>
          <View className="w-px bg-slate-200 dark:bg-slate-700 mx-4" />
          <View className="flex-1">
            <Text className="text-slate-500 dark:text-slate-400 text-xs mb-1">{t('expense')}</Text>
            <Text className="text-red-500 text-lg font-bold">{formatCurrency(totals.expense)}</Text>
          </View>
          <View className="w-px bg-slate-200 dark:bg-slate-700 mx-4" />
          <View className="flex-1">
            <Text className="text-slate-500 dark:text-slate-400 text-xs mb-1">{t('total')}</Text>
            <Text className="text-slate-900 dark:text-white text-lg font-bold">{formatCurrency(totals.income - totals.expense)}</Text>
          </View>
        </View>
      </View>

      {/* Transactions List */}
      <FlatList
        data={groupedTransactions}
        keyExtractor={(item) => item.date}
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        renderItem={({ item: group }) => (
          <View className="mb-6">
            <Text className="text-slate-500 dark:text-slate-400 text-sm font-bold mb-3">{group.date}</Text>
            {group.items.map((item) => {
              const category = categories.find(c => c.name === item.category);
              const isIncome = item.type === 'INCOME';

              return (
                <TouchableOpacity
                  key={item.id}
                  onPress={() => router.push(`/transaction/${item.id}`)}
                  className="flex-row items-center bg-white dark:bg-slate-800 p-4 rounded-2xl mb-3 shadow-sm border border-slate-100 dark:border-slate-700"
                  style={{ elevation: 1 }}
                >
                  <View className="relative">
                    <View
                      className="w-14 h-14 rounded-2xl justify-center items-center mr-4"
                      style={{ backgroundColor: category?.color ? category.color + '20' : (isIncome ? '#dcfce7' : '#fee2e2') }}
                    >
                      <FontAwesome
                        name={category?.icon as any || 'question'}
                        size={20}
                        color={category?.color || (isIncome ? '#16a34a' : '#ef4444')}
                      />
                    </View>
                    {(() => {
                      const account = accounts.find(a => a.id === item.account_id);
                      if (account?.logo) {
                        return (
                          <View className="absolute -bottom-2 -left-2 w-9 h-9 bg-slate-100 dark:bg-slate-700 rounded-full justify-center items-center shadow-sm border border-white dark:border-slate-800 z-10 overflow-hidden">
                            <FontAwesome name="bank" size={12} color="#94a3b8" style={{ position: 'absolute' }} />
                            <Image
                              source={getAccountImageSource(account.logo) as any}
                              className="w-full h-full"
                              resizeMode="cover"
                            />
                          </View>
                        );
                      }
                      return null;
                    })()}
                  </View>
                  <View className="flex-1">
                    <Text className="text-slate-900 dark:text-white font-bold text-base mb-1">{item.description}</Text>
                    <View className="flex-row items-center">
                      <Text className="text-slate-400 text-xs">{item.category}</Text>
                      <View className="w-1 h-1 bg-slate-300 rounded-full mx-2" />
                      <Text className="text-slate-400 text-xs">{formatTime(item.date)}</Text>
                    </View>
                  </View>
                  <View className="items-end">
                    <Text
                      className={`font-bold text-lg ${isIncome ? 'text-green-600' : 'text-red-500'
                        }`}
                    >
                      {isIncome ? '+' : '-'}{formatCurrency(item.amount)}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
        ListEmptyComponent={
          <View className="items-center justify-center mt-20">
            <View className="w-20 h-20 bg-slate-100 dark:bg-slate-800 rounded-full justify-center items-center mb-4">
              <FontAwesome name="search" size={32} color="#cbd5e1" />
            </View>
            <Text className="text-slate-900 dark:text-white font-bold text-lg mb-2">{t('noTransactionsFound')}</Text>
            <Text className="text-slate-400 text-sm text-center">
              {searchQuery ? t('tryAdjustingSearch') : t('startAddingTransactions')}
            </Text>
          </View>
        }
      />

      {/* Floating Action Button - Add Transaction */}
      <TouchableOpacity
        onPress={() => router.push('/modal')}
        className="absolute right-6 bottom-6 shadow-lg"
        style={{ elevation: 6 }}
      >
        <LinearGradient
          colors={['#6366f1', '#4f46e5']}
          className="w-16 h-16 rounded-full justify-center items-center"
        >
          <FontAwesome name="plus" size={22} color="#fff" />
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );
}
