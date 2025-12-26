import { CATEGORIES } from '@/constants/MockData';
import { RootState } from '@/store';
import { fetchTransactions } from '@/store/slices/transactionsSlice';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useState } from 'react';
import { Dimensions, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { LineChart, PieChart } from 'react-native-chart-kit';

import { useDispatch, useSelector } from 'react-redux';

const screenWidth = Dimensions.get('window').width;

export default function ReportsScreen() {
  const router = useRouter();
  const dispatch = useDispatch();
  const { items: transactions } = useSelector((state: RootState) => state.transactions);
  const [timeRange, setTimeRange] = useState<'week' | 'month' | 'year'>('month');

  useEffect(() => {
    // @ts-ignore
    dispatch(fetchTransactions());
  }, [dispatch]);

  // Calculate date range
  const dateRange = useMemo(() => {
    const now = new Date();
    const start = new Date();

    if (timeRange === 'week') {
      start.setDate(now.getDate() - 7);
    } else if (timeRange === 'month') {
      start.setMonth(now.getMonth() - 1);
    } else {
      start.setFullYear(now.getFullYear() - 1);
    }

    return { start: start.getTime(), end: now.getTime() };
  }, [timeRange]);

  // Filter transactions by date range
  const filteredTransactions = useMemo(() => {
    return transactions.filter(t => t.date >= dateRange.start && t.date <= dateRange.end);
  }, [transactions, dateRange]);

  // Calculate monthly income vs expense
  const monthlyData = useMemo(() => {
    const months: { [key: string]: { income: number; expense: number } } = {};

    filteredTransactions.forEach(t => {
      const date = new Date(t.date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

      if (!months[monthKey]) {
        months[monthKey] = { income: 0, expense: 0 };
      }

      if (t.type === 'INCOME') {
        months[monthKey].income += t.amount;
      } else if (t.type === 'EXPENSE') {
        months[monthKey].expense += t.amount;
      }
    });

    const sortedMonths = Object.keys(months).sort();
    const labels = sortedMonths.map(m => {
      const [year, month] = m.split('-');
      return new Date(parseInt(year), parseInt(month) - 1).toLocaleDateString('en', { month: 'short' });
    });

    return {
      labels: labels.length > 0 ? labels : ['No Data'],
      income: sortedMonths.length > 0 ? sortedMonths.map(m => months[m].income) : [0],
      expense: sortedMonths.length > 0 ? sortedMonths.map(m => months[m].expense) : [0],
    };
  }, [filteredTransactions]);

  // Calculate category breakdown
  const categoryData = useMemo(() => {
    const categories: { [key: string]: number } = {};

    filteredTransactions
      .filter(t => t.type === 'EXPENSE')
      .forEach(t => {
        categories[t.category] = (categories[t.category] || 0) + t.amount;
      });

    const total = Object.values(categories).reduce((sum, val) => sum + val, 0);

    return Object.entries(categories)
      .map(([name, amount]) => {
        const category = CATEGORIES.find(c => c.name === name);
        return {
          name,
          amount,
          percentage: total > 0 ? (amount / total) * 100 : 0,
          color: category?.color || '#94a3b8',
          legendFontColor: '#64748b',
          legendFontSize: 12,
        };
      })
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 6); // Top 6 categories
  }, [filteredTransactions]);

  const totalIncome = filteredTransactions
    .filter(t => t.type === 'INCOME')
    .reduce((sum, t) => sum + t.amount, 0);

  const totalExpense = filteredTransactions
    .filter(t => t.type === 'EXPENSE')
    .reduce((sum, t) => sum + t.amount, 0);

  const chartConfig = {
    backgroundColor: '#1e293b',
    backgroundGradientFrom: '#1e293b',
    backgroundGradientTo: '#334155',
    decimalPlaces: 0,
    color: (opacity = 1) => `rgba(255, 255, 255, ${opacity})`,
    labelColor: (opacity = 1) => `rgba(148, 163, 184, ${opacity})`,
    style: {
      borderRadius: 16,
    },
    propsForDots: {
      r: '4',
      strokeWidth: '2',
      stroke: '#3b82f6',
    },
  };

  return (
    <View className="flex-1 bg-slate-50 dark:bg-background-dark">
      <StatusBar style="auto" />

      {/* Header */}
      <LinearGradient colors={['#4f46e5', '#4338ca']} className="px-6 pt-6 pb-8 rounded-b-[32px]" style={{ elevation: 4 }}>
        <View className="flex-row justify-between items-center mb-6">
          <TouchableOpacity onPress={() => router.back()} className="w-10 h-10 bg-white/20 rounded-xl justify-center items-center">
            <FontAwesome name="arrow-left" size={18} color="#fff" />
          </TouchableOpacity>
          <Text className="text-white text-xl font-bold">Financial Reports</Text>
          <View className="w-10 h-10" />
        </View>

        {/* Time Range Selector */}
        <View className="flex-row bg-white/10 backdrop-blur-lg rounded-2xl p-1.5">
          {(['week', 'month', 'year'] as const).map((range) => (
            <TouchableOpacity
              key={range}
              onPress={() => setTimeRange(range)}
              className={`flex-1 py-2 rounded-xl ${timeRange === range ? 'bg-white' : ''}`}
            >
              <Text className={`text-center font-bold text-sm ${timeRange === range ? 'text-indigo-600' : 'text-white'
                }`}>
                {range.charAt(0).toUpperCase() + range.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </LinearGradient>
      <ScrollView className="flex-1 px-6 -mt-6" showsVerticalScrollIndicator={false}>
        {/* Summary Cards */}
        <View className="flex-row mb-6">
          <View className="flex-1 bg-green-500 rounded-3xl p-4 mr-2 shadow-lg" style={{ elevation: 4 }}>
            <FontAwesome name="arrow-down" size={20} color="#fff" />
            <Text className="text-white text-xs mt-2 opacity-90">Income</Text>
            <Text className="text-white text-2xl font-bold">${totalIncome.toFixed(0)}</Text>
          </View>
          <View className="flex-1 bg-red-500 rounded-3xl p-4 ml-2 shadow-lg" style={{ elevation: 4 }}>
            <FontAwesome name="arrow-up" size={20} color="#fff" />
            <Text className="text-white text-xs mt-2 opacity-90">Expense</Text>
            <Text className="text-white text-2xl font-bold">${totalExpense.toFixed(0)}</Text>
          </View>
        </View>

        {/* Income vs Expense Chart */}
        <View className="bg-white dark:bg-slate-800 rounded-3xl p-4 mb-6 shadow-lg border border-slate-100 dark:border-slate-700" style={{ elevation: 4 }}>
          <Text className="text-slate-900 dark:text-white text-lg font-bold mb-4">Income vs Expense</Text>
          {monthlyData.labels.length > 0 && monthlyData.labels[0] !== 'No Data' ? (
            <LineChart
              data={{
                labels: monthlyData.labels,
                datasets: [
                  {
                    data: monthlyData.income,
                    color: (opacity = 1) => `rgba(16, 185, 129, ${opacity})`,
                    strokeWidth: 3,
                  },
                  {
                    data: monthlyData.expense,
                    color: (opacity = 1) => `rgba(239, 68, 68, ${opacity})`,
                    strokeWidth: 3,
                  },
                ],
                legend: ['Income', 'Expense'],
              }}
              width={screenWidth - 80}
              height={220}
              chartConfig={chartConfig}
              bezier
              style={{
                borderRadius: 16,
              }}
            />
          ) : (
            <View className="h-52 justify-center items-center">
              <FontAwesome name="line-chart" size={48} color="#cbd5e1" />
              <Text className="text-slate-400 mt-4">No data available</Text>
            </View>
          )}
        </View>

        {/* Category Breakdown */}
        <View className="bg-white dark:bg-slate-800 rounded-3xl p-4 mb-6 shadow-lg border border-slate-100 dark:border-slate-700" style={{ elevation: 4 }}>
          <Text className="text-slate-900 dark:text-white text-lg font-bold mb-4">Expense by Category</Text>
          {categoryData.length > 0 ? (
            <>
              <PieChart
                data={categoryData}
                width={screenWidth - 80}
                height={220}
                chartConfig={chartConfig}
                accessor="amount"
                backgroundColor="transparent"
                paddingLeft="15"
                absolute
              />
              <View className="mt-4">
                {categoryData.map((item, index) => (
                  <View key={index} className="flex-row justify-between items-center mb-3">
                    <View className="flex-row items-center flex-1">
                      <View
                        className="w-4 h-4 rounded-full mr-3"
                        style={{ backgroundColor: item.color }}
                      />
                      <Text className="text-slate-700 dark:text-slate-300 text-sm flex-1">
                        {item.name}
                      </Text>
                    </View>
                    <View className="items-end">
                      <Text className="text-slate-900 dark:text-white font-bold">
                        ${item.amount.toFixed(0)}
                      </Text>
                      <Text className="text-slate-500 text-xs">
                        {item.percentage.toFixed(1)}%
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </>
          ) : (
            <View className="h-52 justify-center items-center">
              <FontAwesome name="pie-chart" size={48} color="#cbd5e1" />
              <Text className="text-slate-400 mt-4">No expense data</Text>
            </View>
          )}
        </View>

        <View className="h-8" />
      </ScrollView>
    </View>
  );
}
