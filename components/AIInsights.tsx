import { useTheme } from '@/contexts/ThemeContext';
import { FinancialAdvisorService, FinancialInsight } from '@/services/FinancialAdvisorService';
import { Transaction } from '@/types/database';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';

interface AIInsightsProps {
  transactions: Transaction[];
  previousPeriodTransactions?: Transaction[];
}

export default function AIInsights({ transactions, previousPeriodTransactions = [] }: AIInsightsProps) {
  const { actualTheme } = useTheme();
  const [insights, setInsights] = useState<FinancialInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    analyzeData();
  }, [transactions, previousPeriodTransactions]);

  const analyzeData = async () => {
    setLoading(true);
    
    // Simulate AI thinking time for better UX
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const results = FinancialAdvisorService.analyzeTransactions(
      transactions,
      previousPeriodTransactions
    );
    
    setInsights(results);
    setLoading(false);
  };

  const getInsightGradient = (type: FinancialInsight['type']) => {
    if (actualTheme === 'dark') {
      switch (type) {
        case 'success': return ['#065f46', '#064e3b'];
        case 'warning': return ['#991b1b', '#7f1d1d'];
        case 'info': return ['#1e40af', '#1e3a8a'];
        case 'suggestion': return ['#92400e', '#78350f'];
        default: return ['#374151', '#1f2937'];
      }
    }
    
    switch (type) {
      case 'success': return ['#10b981', '#059669'];
      case 'warning': return ['#f59e0b', '#d97706'];
      case 'info': return ['#3b82f6', '#2563eb'];
      case 'suggestion': return ['#8b5cf6', '#7c3aed'];
      default: return ['#6b7280', '#4b5563'];
    }
  };

  if (transactions.length === 0) {
    return null;
  }

  return (
    <View className="mb-6">
      {/* Header */}
      <TouchableOpacity
        onPress={() => setExpanded(!expanded)}
        className="flex-row items-center justify-between mb-4"
      >
        <View className="flex-row items-center">
          <LinearGradient
            colors={actualTheme === 'dark' ? ['#4c1d95', '#5b21b6'] : ['#8b5cf6', '#7c3aed']}
            className="w-10 h-10 rounded-xl justify-center items-center mr-3"
          >
            <FontAwesome name="robot" size={20} color="#fff" />
          </LinearGradient>
          <View>
            <Text className="text-slate-900 dark:text-white text-lg font-bold">
              AI Financial Insights
            </Text>
            <Text className="text-slate-500 dark:text-slate-400 text-xs">
              {insights.length} insights • Updated just now
            </Text>
          </View>
        </View>
        <FontAwesome 
          name={expanded ? 'chevron-up' : 'chevron-down'} 
          size={16} 
          color={actualTheme === 'dark' ? '#94a3b8' : '#64748b'} 
        />
      </TouchableOpacity>

      {/* Insights List */}
      {expanded && (
        <View>
          {loading ? (
            <View className="bg-white dark:bg-slate-800 rounded-2xl p-8 items-center">
              <ActivityIndicator size="large" color="#8b5cf6" />
              <Text className="text-slate-500 dark:text-slate-400 mt-4">
                Analyzing your financial data...
              </Text>
            </View>
          ) : insights.length === 0 ? (
            <View className="bg-white dark:bg-slate-800 rounded-2xl p-6 items-center">
              <FontAwesome name="check-circle" size={48} color="#10b981" />
              <Text className="text-slate-900 dark:text-white font-bold mt-4 text-lg">
                All Looking Good!
              </Text>
              <Text className="text-slate-500 dark:text-slate-400 text-center mt-2">
                Your finances are healthy. Keep up the great work!
              </Text>
            </View>
          ) : (
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false}
              className="-mx-6 px-6"
            >
              {insights.map((insight, index) => (
                <View
                  key={insight.id}
                  className="mr-4"
                  style={{ width: 300 }}
                >
                  <LinearGradient
                    colors={getInsightGradient(insight.type)}
                    className="rounded-2xl p-5 shadow-lg"
                    style={{ elevation: 4 }}
                  >
                    <View className="flex-row items-start mb-3">
                      <View className="w-10 h-10 bg-white/20 rounded-xl justify-center items-center mr-3">
                        <FontAwesome name={insight.icon as any} size={18} color="#fff" />
                      </View>
                      <View className="flex-1">
                        <Text className="text-white font-bold text-base">
                          {insight.title}
                        </Text>
                      </View>
                    </View>
                    
                    <Text className="text-white/90 text-sm leading-5">
                      {insight.description}
                    </Text>

                    {/* Priority indicator */}
                    <View className="mt-4 flex-row items-center">
                      <View className="flex-1 h-1 bg-white/20 rounded-full overflow-hidden">
                        <View 
                          className="h-full bg-white/50 rounded-full"
                          style={{ width: `${insight.priority}%` }}
                        />
                      </View>
                      <Text className="text-white/60 text-xs ml-2 font-medium">
                        {insight.priority > 80 ? 'Critical' : insight.priority > 60 ? 'Important' : 'Helpful'}
                      </Text>
                    </View>
                  </LinearGradient>
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      )}
    </View>
  );
}
