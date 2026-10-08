import { useAppSettings } from '@/contexts/AppSettingsContext';
import { useTheme } from '@/contexts/ThemeContext';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from '@/components/aurora/AuroraGradient';
import React, { memo } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

interface FinancialPulseProps {
  monthlyNet: number;
  savingsRate: number;
  overBudgetCount: number;
  nearBudgetCount: number;
  dueSoonLoanCount: number;
  topExpenseCategoryName?: string;
  topExpenseCategoryAmount?: number;
  /** False before anything has been recorded, so the card does not assert a verdict. */
  hasData?: boolean;
  /** Mirrors the global "hide balances" setting; masks every figure this card shows. */
  balancesHidden?: boolean;
  onOpenBudget: () => void;
  onOpenLoans: () => void;
  onOpenAssistant: () => void;
}

function FinancialPulse({
  monthlyNet,
  savingsRate,
  overBudgetCount,
  nearBudgetCount,
  dueSoonLoanCount,
  topExpenseCategoryName,
  topExpenseCategoryAmount = 0,
  hasData = true,
  balancesHidden = false,
  onOpenBudget,
  onOpenLoans,
  onOpenAssistant,
}: FinancialPulseProps) {
  const { formatCurrency, fontSize } = useAppSettings();
  const { isAurora } = useTheme();
  const isVerySmall = fontSize === 'V.Small';
  const headline = getHeadline({
    hasData,
    monthlyNet,
    savingsRate,
    overBudgetCount,
    dueSoonLoanCount,
    topExpenseCategoryName,
    topExpenseCategoryAmount,
    formatCurrency,
    balancesHidden,
  });

  if (isAurora) {
    // Clamp for the ring: never claim more than 100% saved, never draw a
    // negative arc when the month is in the red.
    const ringPct = Math.max(0, Math.min(100, savingsRate));
    const radius = 34, stroke = 9, circumference = 2 * Math.PI * radius;
    const dash = hasData ? (ringPct / 100) * circumference : 0;

    return (
      <View className="mb-8">
        <View className="rounded-3xl p-5 border" style={{ backgroundColor: 'rgba(255,255,255,0.08)', borderColor: 'rgba(255,255,255,0.18)', elevation: 4 }}>
          <View className="flex-row items-center" style={{ gap: 16 }}>
            <View style={{ width: 84, height: 84 }}>
              <Svg width={84} height={84} viewBox="0 0 84 84">
                <Circle cx={42} cy={42} r={radius} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth={stroke} />
                <Circle
                  cx={42} cy={42} r={radius} fill="none" stroke="#67e8f9" strokeWidth={stroke}
                  strokeLinecap="round" strokeDasharray={`${dash} ${circumference}`}
                  rotation={-90} origin="42,42"
                />
              </Svg>
              <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>
                <Text className="text-white font-extrabold text-lg">{hasData ? `${Math.round(ringPct)}%` : '—'}</Text>
                <Text className="text-white/80" style={{ fontSize: 10 }}>Saved</Text>
              </View>
            </View>
            <View className="flex-1">
              <Text className="text-white/80 text-xs">This month's pulse</Text>
              <Text className="text-white font-extrabold text-lg mt-0.5" numberOfLines={1} adjustsFontSizeToFit>
                {!hasData ? '—' : balancesHidden ? '•••••• net' : `${monthlyNet >= 0 ? '+' : ''}${formatCurrency(monthlyNet)} net`}
              </Text>
              <Text className="text-white/80 text-xs mt-1" numberOfLines={2}>{headline}</Text>
            </View>
          </View>

          {(overBudgetCount > 0 || dueSoonLoanCount > 0) && (
            <View className="mt-4" style={{ gap: 8 }}>
              {overBudgetCount > 0 && (
                <TouchableOpacity
                  onPress={onOpenBudget}
                  accessibilityRole="button"
                  className="flex-row items-center rounded-2xl px-3 py-2.5"
                  style={{ backgroundColor: 'rgba(251,113,133,0.14)', borderWidth: 1, borderColor: 'rgba(251,113,133,0.3)' }}
                >
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#fb7185' }} />
                  <Text className="text-white text-sm ml-2.5 flex-1">
                    {overBudgetCount} {overBudgetCount === 1 ? 'category is' : 'categories are'} over budget
                  </Text>
                  <FontAwesome name="chevron-right" size={11} color="rgba(255,255,255,0.6)" />
                </TouchableOpacity>
              )}
              {dueSoonLoanCount > 0 && (
                <TouchableOpacity
                  onPress={onOpenLoans}
                  accessibilityRole="button"
                  className="flex-row items-center rounded-2xl px-3 py-2.5"
                  style={{ backgroundColor: 'rgba(251,191,36,0.13)', borderWidth: 1, borderColor: 'rgba(251,191,36,0.3)' }}
                >
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#fbbf24' }} />
                  <Text className="text-white text-sm ml-2.5 flex-1">
                    {dueSoonLoanCount} loan {dueSoonLoanCount === 1 ? 'payment is' : 'payments are'} due this week
                  </Text>
                  <FontAwesome name="chevron-right" size={11} color="rgba(255,255,255,0.6)" />
                </TouchableOpacity>
              )}
            </View>
          )}

          <View className="flex-row mt-4" style={{ gap: 8 }}>
            <AuroraChip label="Budget" icon="pie-chart" onPress={onOpenBudget} />
            <AuroraChip label="Loans" icon="money" onPress={onOpenLoans} />
            <AuroraChip label="AI" icon="magic" onPress={onOpenAssistant} />
          </View>
        </View>
      </View>
    );
  }

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
            <Text className={`text-slate-500 mt-1 leading-5 ${isVerySmall ? 'text-xs' : 'text-sm'} dark:text-slate-400`}>
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

export default memo(FinancialPulse);

function getHeadline({
  hasData,
  monthlyNet,
  savingsRate,
  overBudgetCount,
  dueSoonLoanCount,
  topExpenseCategoryName,
  topExpenseCategoryAmount,
  formatCurrency,
  balancesHidden,
}: {
  hasData: boolean;
  monthlyNet: number;
  savingsRate: number;
  overBudgetCount: number;
  dueSoonLoanCount: number;
  topExpenseCategoryName?: string;
  topExpenseCategoryAmount: number;
  formatCurrency: (amount: number) => string;
  balancesHidden?: boolean;
}) {
  const amount = (value: number) => balancesHidden ? '••••••' : formatCurrency(value);
  // With an empty ledger every metric is zero, which used to fall through to
  // "Your financial health is stable" — a verdict on data that does not exist.
  if (!hasData) {
    return 'Add an account and record your first transaction, and this card will start tracking your month.';
  }
  if (monthlyNet < 0) {
    return `This month is negative by ${amount(Math.abs(monthlyNet))}. Focus on essential spending only this week.`;
  }
  if (overBudgetCount > 0) {
    return `You are over budget in ${overBudgetCount} ${overBudgetCount === 1 ? 'category' : 'categories'}. Rebalance now before month-end.`;
  }
  if (dueSoonLoanCount > 0) {
    return `${dueSoonLoanCount} ${dueSoonLoanCount === 1 ? 'loan payment is' : 'loan payments are'} due in 7 days. Plan cash coverage early.`;
  }
  if (topExpenseCategoryName) {
    return `Top expense focus is ${topExpenseCategoryName} at ${amount(topExpenseCategoryAmount)}. Try trimming it by 10%.`;
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
      ? 'bg-emerald-500/15 border-emerald-400/30'
      : tone === 'warn'
        ? 'bg-amber-500/15 border-amber-400/30'
        : 'bg-rose-500/15 border-rose-400/30';
  const toneTextClass =
    tone === 'good'
      ? 'text-emerald-100'
      : tone === 'warn'
        ? 'text-amber-100'
        : 'text-rose-100';

  return (
    <View className={`flex-1 rounded-xl border p-2.5 mr-2 ${toneClass}`}>
      <Text className={`text-[10px] uppercase tracking-wide opacity-90 ${toneTextClass}`}>{label}</Text>
      <Text className={`font-bold text-xs mt-1 ${toneTextClass}`}>{value}</Text>
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

function AuroraChip({ label, icon, onPress }: { label: string; icon: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      activeOpacity={0.8}
      className="flex-1 rounded-xl py-2.5 px-3 flex-row items-center justify-center"
      style={{ backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' }}
    >
      <FontAwesome name={icon as any} size={12} color="#ffffff" />
      <Text className="text-white text-xs font-semibold ml-2">{label}</Text>
    </TouchableOpacity>
  );
}
