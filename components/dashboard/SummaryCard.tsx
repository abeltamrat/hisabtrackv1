import { useAppSettings } from '@/contexts/AppSettingsContext';
import { useI18n } from '@/contexts/I18nContext';
import { useTheme } from '@/contexts/ThemeContext';
import Coin3D from '@/components/three-d/Coin3D';
import { FontAwesome } from '@expo/vector-icons';
import React, { memo } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

interface SummaryCardProps {
  balance: number;
  income: number;
  expense: number;
  percentageChange?: number;
  /** True until the ledger has loaded, so zeroes are not shown as real totals. */
  loading?: boolean;
  /** Cumulative daily balance delta across the recent window, oldest first — draws the sparkline. */
  trendPoints?: number[];
}

/** A smooth path through `points`, normalised into a 0–`width` × 0–`height` box. */
function sparklinePath(points: number[], width: number, height: number): string {
  if (points.length < 2) return '';
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const stepX = width / (points.length - 1);
  const coords = points.map((value, index) => ({
    x: index * stepX,
    y: height - ((value - min) / span) * height,
  }));
  return coords.reduce((path, point, index) => {
    if (index === 0) return `M ${point.x} ${point.y}`;
    const prev = coords[index - 1];
    const midX = (prev.x + point.x) / 2;
    return `${path} C ${midX} ${prev.y}, ${midX} ${point.y}, ${point.x} ${point.y}`;
  }, '');
}

function SummaryCard({ balance, income, expense, percentageChange = 0, loading = false, trendPoints }: SummaryCardProps) {
  const isPositive = percentageChange >= 0;
  const { formatCurrency, fontSize, balancesHidden, setBalancesHidden } = useAppSettings();
  const { t } = useI18n();
  const { isAurora } = useTheme();
  const isVerySmall = fontSize === 'V.Small';
  const titleSize = fontSize === 'V.Small' ? 'text-2xl' : fontSize === 'Small' ? 'text-3xl' : fontSize === 'Large' ? 'text-5xl' : 'text-4xl';
  const valueSize = fontSize === 'V.Small' ? 'text-base' : fontSize === 'Small' ? 'text-lg' : fontSize === 'Large' ? 'text-2xl' : 'text-xl';

  if (isAurora) {
    const sparkW = 300, sparkH = 48;
    const path = !loading && !balancesHidden && trendPoints && trendPoints.length >= 2 ? sparklinePath(trendPoints, sparkW, sparkH) : '';
    const lastPoint = trendPoints && trendPoints.length >= 2
      ? { x: sparkW, y: sparkH - ((trendPoints[trendPoints.length - 1] - Math.min(...trendPoints)) / ((Math.max(...trendPoints) - Math.min(...trendPoints)) || 1)) * sparkH }
      : null;

    return (
      <View style={{ marginHorizontal: -6 }}>
        <View
          className="rounded-3xl p-6 border"
          style={{
            backgroundColor: 'rgba(255,255,255,0.09)',
            borderColor: 'rgba(255,255,255,0.2)',
            elevation: 8,
          }}
        >
          <View className="flex-row justify-between items-center">
            <Text className="text-white/90 text-sm font-medium">Total Balance</Text>
            {!balancesHidden && !loading && (
              <View className={`flex-row items-center px-2.5 py-1 rounded-full ${isPositive ? 'bg-emerald-500/20' : 'bg-rose-500/20'}`}>
                <FontAwesome name={isPositive ? 'arrow-up' : 'arrow-down'} size={9} color={isPositive ? '#6ee7b7' : '#fda4af'} />
                <Text className={`text-xs font-bold ml-1 ${isPositive ? 'text-emerald-300' : 'text-rose-300'}`}>
                  {isPositive ? '+' : ''}{percentageChange.toFixed(1)}%
                </Text>
              </View>
            )}
          </View>

          <View className="flex-row items-baseline mt-2">
            <Text
              className={`text-white ${titleSize} font-extrabold`}
              accessibilityLabel={loading ? 'Loading total balance' : undefined}
              adjustsFontSizeToFit
              numberOfLines={1}
            >
              {loading ? '—' : balancesHidden ? '••••••' : formatCurrency(balance)}
            </Text>
            <TouchableOpacity
              onPress={() => setBalancesHidden(!balancesHidden)}
              accessibilityRole="button"
              accessibilityLabel={balancesHidden ? 'Show balances' : 'Hide balances'}
              className="w-9 h-9 rounded-full bg-white/10 justify-center items-center ml-3"
            >
              <FontAwesome name={balancesHidden ? 'eye-slash' : 'eye'} size={14} color="#ffffff" />
            </TouchableOpacity>
          </View>

          {!!path && (
            <Svg width="100%" height={sparkH} viewBox={`0 0 ${sparkW} ${sparkH}`} style={{ marginTop: 10 }}>
              <Path d={path} fill="none" stroke="#67e8f9" strokeWidth={2.5} strokeLinecap="round" />
              {lastPoint && <Circle cx={lastPoint.x} cy={lastPoint.y} r={4} fill="#67e8f9" />}
            </Svg>
          )}

          <View className="flex-row mt-3" style={{ gap: 10 }}>
            <View className="flex-1 rounded-2xl p-3" style={{ backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
              <Text className="text-white/80 text-xs">{t('inFlow')}</Text>
              <Text className="text-emerald-300 font-bold mt-0.5" style={{ fontSize: isVerySmall ? 14 : 17 }} numberOfLines={1} adjustsFontSizeToFit>
                {loading ? '—' : balancesHidden ? '••••••' : `+${formatCurrency(income)}`}
              </Text>
            </View>
            <View className="flex-1 rounded-2xl p-3" style={{ backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
              <Text className="text-white/80 text-xs">{t('outFlow')}</Text>
              <Text className="text-rose-300 font-bold mt-0.5" style={{ fontSize: isVerySmall ? 14 : 17 }} numberOfLines={1} adjustsFontSizeToFit>
                {loading ? '—' : balancesHidden ? '••••••' : `−${formatCurrency(expense)}`}
              </Text>
            </View>
          </View>
        </View>

        {/* Playful floating coin, purely decorative */}
        <View pointerEvents="none" style={{ position: 'absolute', top: -14, right: 18 }}>
          <Coin3D size={52} />
        </View>
      </View>
    );
  }

  return (
    <View className={`bg-white dark:bg-slate-800 rounded-3xl ${isVerySmall ? 'p-4' : 'p-6'} shadow-2xl`} style={{ elevation: 8, marginHorizontal: -6 }}>
      <View className="items-center mb-6">
        <Text className={`text-slate-500 dark:text-slate-400 ${isVerySmall ? 'text-xs' : 'text-sm'} font-medium mb-2`}>Total Balance</Text>
        <View className="flex-row items-center justify-center">
          <Text
            className={`text-slate-900 dark:text-white ${titleSize} font-bold text-center`}
            accessibilityLabel={loading ? 'Loading total balance' : undefined}
          >
            {loading ? '—' : balancesHidden ? '••••••' : formatCurrency(balance)}
          </Text>
          <TouchableOpacity
            onPress={() => setBalancesHidden(!balancesHidden)}
            accessibilityRole="button"
            accessibilityLabel={balancesHidden ? 'Show balances' : 'Hide balances'}
            className={`${isVerySmall ? 'w-8 h-8' : 'w-9 h-9'} rounded-full bg-slate-100 dark:bg-slate-700 justify-center items-center ml-3`}
          >
            <FontAwesome name={balancesHidden ? 'eye-slash' : 'eye'} size={isVerySmall ? 13 : 15} color="#64748b" />
          </TouchableOpacity>
        </View>
        {!balancesHidden && !loading && (
          <View className={`flex-row items-center mt-2 ${isVerySmall ? 'px-2 py-1' : 'px-3 py-1.5'} rounded-full ${isPositive ? 'bg-green-50 dark:bg-green-900/30' : 'bg-red-50 dark:bg-red-900/30'}`}>
            <FontAwesome name={isPositive ? "arrow-up" : "arrow-down"} size={isVerySmall ? 9 : 10} color={isPositive ? "#10b981" : "#ef4444"} />
            <Text className={`${isVerySmall ? 'text-[10px]' : 'text-xs'} font-bold ml-1 ${isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {isPositive ? '+' : ''}{percentageChange.toFixed(1)}%
            </Text>
          </View>
        )}
      </View>

      <View className="flex-row justify-between">
        <View className="flex-1 mr-3">
          <View className="flex-row items-center mb-2">
            <View className={`${isVerySmall ? 'w-7 h-7' : 'w-8 h-8'} bg-green-100 dark:bg-green-900/30 rounded-xl justify-center items-center mr-2`}>
              <FontAwesome name="arrow-down" size={isVerySmall ? 11 : 12} color="#10b981" />
            </View>
            <View>
              <Text className={`text-slate-500 dark:text-slate-400 ${isVerySmall ? 'text-[10px]' : 'text-xs'} font-medium`}>{t('income')}</Text>
              <Text className={`text-slate-500 dark:text-slate-400 ${isVerySmall ? 'text-[10px]' : 'text-[10px]'}`}>This Month</Text>
            </View>
          </View>
          <Text className={`text-slate-900 dark:text-white ${valueSize} font-bold`}>{loading ? '—' : formatCurrency(income)}</Text>
        </View>
        <View className="w-px bg-slate-200 dark:bg-slate-700" />
        <View className="flex-1 ml-3">
          <View className="flex-row items-center mb-2">
            <View className={`${isVerySmall ? 'w-7 h-7' : 'w-8 h-8'} bg-red-100 dark:bg-red-900/30 rounded-xl justify-center items-center mr-2`}>
              <FontAwesome name="arrow-up" size={isVerySmall ? 11 : 12} color="#ef4444" />
            </View>
            <View>
              <Text className={`text-slate-500 dark:text-slate-400 ${isVerySmall ? 'text-[10px]' : 'text-xs'} font-medium`}>{t('expense')}</Text>
              <Text className={`text-slate-500 dark:text-slate-400 ${isVerySmall ? 'text-[10px]' : 'text-[10px]'}`}>This Month</Text>
            </View>
          </View>
          <Text className={`text-slate-900 dark:text-white ${valueSize} font-bold`}>{loading ? '—' : formatCurrency(expense)}</Text>
        </View>
      </View>
    </View>
  );
}

export default memo(SummaryCard);
