import { useAppSettings } from '@/contexts/AppSettingsContext';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

interface FinancialPulseProps {
  monthlyNet: number;
  savingsRate: number;
  overBudgetCount: number;
  nearBudgetCount: number;
  dueSoonLoanCount: number;
  topExpenseCategoryName?: string;
  topExpenseCategoryAmount?: number;
  onOpenBudget: () => void;
  onOpenLoans: () => void;
  onOpenAssistant: () => void;
}

export default function FinancialPulse({
  monthlyNet,
  savingsRate,
  overBudgetCount,
  nearBudgetCount,
  dueSoonLoanCount,
  topExpenseCategoryName,
  topExpenseCategoryAmount = 0,
  onOpenBudget,
  onOpenLoans,
  onOpenAssistant,
}: FinancialPulseProps) {
  const { formatCurrency, fontSize } = useAppSettings();
  const isVerySmall = fontSize === 'V.Small';
  const headline = getHeadline({
    monthlyNet,
    savingsRate,
    overBudgetCount,
    dueSoonLoanCount,
    topExpenseCategoryName,
    topExpenseCategoryAmount,
    formatCurrency,
  });

  return (
    <View className="mb-8">
      <LinearGradient
        colors={['#0f172a', '#1e293b', '#334155']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        className={`rounded-3xl ${isVerySmall ? 'p-4' : 'p-5'} border border-slate-700`}
        style={{ elevation: 4 }}
      >
        <View className="flex-row items-start justify-between">
          <View className="flex-1 pr-3">
            <Text className={`text-slate-100 font-bold ${isVerySmall ? 'text-base' : 'text-lg'}`}>
              Financial Pulse
            </Text>
            <Text className={`text-slate-300 mt-1 leading-5 ${isVerySmall ? 'text-xs' : 'text-sm'}`}>
              {headline}
            </Text>
          </View>
          <View className={`${isVerySmall ? 'w-10 h-10' : 'w-11 h-11'} rounded-2xl bg-cyan-500/20 items-center justify-center`}>
            <FontAwesome name="heartbeat" size={isVerySmall ? 16 : 18} color="#22d3ee" />
          </View>
        </View>

        <View className="flex-row mt-4">
          <MetricPill
            label="Savings"
            value={`${savingsRate.toFixed(1)}%`}
            tone={savingsRate >= 20 ? 'good' : savingsRate >= 10 ? 'warn' : 'danger'}
          />
          <MetricPill
            label="Budgets"
            value={overBudgetCount > 0 ? `${overBudgetCount} over` : nearBudgetCount > 0 ? `${nearBudgetCount} near` : 'Healthy'}
            tone={overBudgetCount > 0 ? 'danger' : nearBudgetCount > 0 ? 'warn' : 'good'}
          />
          <MetricPill
            label="Loan Due"
            value={`${dueSoonLoanCount}`}
            tone={dueSoonLoanCount > 0 ? 'warn' : 'good'}
          />
        </View>

        <View className="flex-row mt-4">
          <ActionChip label="Budget" icon="pie-chart" onPress={onOpenBudget} />
          <ActionChip label="Loans" icon="money" onPress={onOpenLoans} />
          <ActionChip label="AI" icon="magic" onPress={onOpenAssistant} />
        </View>
      </LinearGradient>
    </View>
  );
}

function getHeadline({
  monthlyNet,
  savingsRate,
  overBudgetCount,
  dueSoonLoanCount,
  topExpenseCategoryName,
  topExpenseCategoryAmount,
  formatCurrency,
}: {
  monthlyNet: number;
  savingsRate: number;
  overBudgetCount: number;
  dueSoonLoanCount: number;
  topExpenseCategoryName?: string;
  topExpenseCategoryAmount: number;
  formatCurrency: (amount: number) => string;
}) {
  if (monthlyNet < 0) {
    return `This month is negative by ${formatCurrency(Math.abs(monthlyNet))}. Focus on essential spending only this week.`;
  }
  if (overBudgetCount > 0) {
    return `You are over budget in ${overBudgetCount} ${overBudgetCount === 1 ? 'category' : 'categories'}. Rebalance now before month-end.`;
  }
  if (dueSoonLoanCount > 0) {
    return `${dueSoonLoanCount} ${dueSoonLoanCount === 1 ? 'loan payment is' : 'loan payments are'} due in 7 days. Plan cash coverage early.`;
  }
  if (topExpenseCategoryName) {
    return `Top expense focus is ${topExpenseCategoryName} at ${formatCurrency(topExpenseCategoryAmount)}. Try trimming it by 10%.`;
  }
  if (savingsRate >= 20) {
    return 'Your current savings momentum is strong. Keep this pace and protect your emergency buffer.';
  }
  return 'Your financial health is stable. Keep logging transactions daily for sharper insights.';
}

function MetricPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'good' | 'warn' | 'danger';
}) {
  const toneClass =
    tone === 'good'
      ? 'bg-emerald-500/15 border-emerald-400/30 text-emerald-200'
      : tone === 'warn'
        ? 'bg-amber-500/15 border-amber-400/30 text-amber-200'
        : 'bg-rose-500/15 border-rose-400/30 text-rose-200';

  return (
    <View className={`flex-1 rounded-xl border p-2.5 mr-2 ${toneClass}`}>
      <Text className="text-[10px] uppercase tracking-wide opacity-80">{label}</Text>
      <Text className="font-bold text-xs mt-1">{value}</Text>
    </View>
  );
}

function ActionChip({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      className="flex-1 mr-2 rounded-xl bg-white/10 border border-white/15 py-2.5 px-3 flex-row items-center justify-center"
      activeOpacity={0.8}
    >
      <FontAwesome name={icon as any} size={12} color="#e2e8f0" />
      <Text className="text-slate-100 text-xs font-semibold ml-2">{label}</Text>
    </TouchableOpacity>
  );
}
