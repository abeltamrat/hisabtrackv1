import { Stack } from 'expo-router';
import { vars } from 'nativewind';
import React from 'react';
import { ScrollView, Text, View } from 'react-native';

import AuroraBackground from '@/components/aurora/AuroraBackground';
import CustomTabBar from '@/components/CustomTabBar';
import { AURORA_VARS } from '@/components/aurora/palette';
import SummaryCard from '@/components/dashboard/SummaryCard';
import FinancialPulse from '@/components/dashboard/FinancialPulse';
import Coin3D from '@/components/three-d/Coin3D';
import Wallet3D from '@/components/three-d/Wallet3D';
import Shield3D from '@/components/three-d/Shield3D';
import Gift3D from '@/components/three-d/Gift3D';
import Target3D from '@/components/three-d/Target3D';
import Icon3D from '@/components/three-d/Icon3D';

/**
 * Developer-only lab for the Aurora theme: real shared components rendered
 * with representative data, so the look can be checked without needing a
 * signed-in session. Not reachable from the app; production builds render
 * nothing.
 */
const auroraStyle = vars(AURORA_VARS);

function Sample({ label }: { label: string }) {
  return (
    <View className="gap-3">
      <Text className="text-white text-base font-bold">{label}</Text>
      <View className="bg-slate-800 rounded-3xl p-5 border border-slate-700">
        <Text className="text-slate-100 text-sm">Total balance</Text>
        <Text className="text-white text-3xl font-extrabold mt-1">ETB 84,250.60</Text>
        <View className="flex-row gap-2 mt-4">
          <View className="flex-1 bg-slate-700 rounded-2xl p-3">
            <Text className="dark:text-slate-400 text-xs">In</Text>
            <Text className="text-emerald-300 font-bold">+32,500</Text>
          </View>
          <View className="flex-1 bg-slate-700 rounded-2xl p-3">
            <Text className="dark:text-slate-400 text-xs">Out</Text>
            <Text className="text-rose-300 font-bold">−18,940</Text>
          </View>
        </View>
      </View>
      <View className="bg-slate-900 rounded-3xl p-5 border border-slate-700">
        <Text className="text-white font-bold">A sheet (slate-900)</Text>
        <View className="bg-slate-800 rounded-xl px-3 py-3 mt-3 border border-slate-700">
          <Text className="dark:text-slate-400">Input field</Text>
        </View>
      </View>
    </View>
  );
}

export default function AuroraLab() {
  if (!__DEV__) return null;
  return (
    <View className="flex-1">
      <Stack.Screen options={{ headerShown: false }} />
      <AuroraBackground />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 28, paddingBottom: 100 }}>
        <View className="bg-background-dark p-4 rounded-3xl gap-3">
          <Sample label="Today (no override)" />
        </View>
        <View style={auroraStyle} className="bg-background-dark p-4 rounded-3xl gap-3">
          <Sample label="Aurora (vars override)" />
        </View>

        <View style={{ gap: 12 }}>
          <Text className="text-white text-base font-bold">Real SummaryCard (Aurora)</Text>
          <SummaryCard balance={84250.6} income={32500} expense={18940} percentageChange={6.2} trendPoints={[0, 1200, 900, 2400, 1800, 3200, 2600, 4100, 3500, 5200, 4600, 6300, 5700, 7200, 6800]} />
        </View>

        <View style={{ gap: 12 }}>
          <Text className="text-white text-base font-bold">Real FinancialPulse (Aurora)</Text>
          <FinancialPulse
            monthlyNet={13560}
            savingsRate={42}
            overBudgetCount={1}
            nearBudgetCount={0}
            dueSoonLoanCount={1}
            topExpenseCategoryName="Groceries"
            topExpenseCategoryAmount={6420}
            hasData
            onOpenBudget={() => {}}
            onOpenLoans={() => {}}
            onOpenAssistant={() => {}}
          />
        </View>

        <View style={{ gap: 12 }}>
          <Text className="text-white text-base font-bold">Account chips + 8-action grid</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
            {['CBE', 'telebirr', 'Cash'].map(name => (
              <View key={name} className="rounded-2xl px-3.5 py-2.5" style={{ backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' }}>
                <Text className="text-white/90 text-[11px]">{name}</Text>
                <Text className="text-white font-extrabold text-sm mt-0.5">ETB 9,840</Text>
              </View>
            ))}
            <View className="rounded-2xl px-3.5 py-2.5" style={{ backgroundColor: 'rgba(103,232,249,0.12)', borderWidth: 1, borderColor: 'rgba(103,232,249,0.35)' }}>
              <Text className="text-cyan-200 text-[11px]">Held by Abebe</Text>
              <Text className="text-white font-extrabold text-sm mt-0.5">ETB 3,250</Text>
            </View>
          </ScrollView>
          <View className="flex-row flex-wrap" style={{ gap: 10 }}>
            {[
              { key: 'add', label: 'Add', icon: true },
              { key: 'transfer', label: 'Transfer' },
              { key: 'sms', label: 'SMS', badge: 3 },
              { key: 'funds', label: 'Funds' },
              { key: 'budget', label: 'Budget' },
              { key: 'reports', label: 'Reports' },
              { key: 'equb', label: 'Equb' },
              { key: 'more', label: 'More' },
            ].map(a => (
              <View key={a.key} style={{ width: '23%', alignItems: 'center' }} className="py-3 rounded-2xl">
                <View style={{ position: 'relative' }}>
                  <View
                    className="rounded-2xl justify-center items-center"
                    style={{ width: 54, height: 54, backgroundColor: a.icon ? 'rgba(103,232,249,0.9)' : 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: a.icon ? 'rgba(103,232,249,0.9)' : 'rgba(255,255,255,0.18)' }}
                  />
                  {!!a.badge && (
                    <View style={{ position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: '#fb7185', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
                      <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{a.badge}</Text>
                    </View>
                  )}
                </View>
                <Text className="text-white text-[11px] font-semibold mt-1.5">{a.label}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={{ gap: 12 }}>
          <Text className="text-white text-base font-bold">3D object library</Text>
          <View style={{ flexDirection: 'row', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
            <Coin3D size={64} />
            <Wallet3D size={64} />
            <Shield3D size={64} />
            <Gift3D size={64} />
            <Target3D size={64} />
          </View>
          <Text className="text-white/70 text-xs">All floating + reduce-motion aware</Text>

          <Text className="text-white text-base font-bold mt-2">Icon3D (quick-action tiles)</Text>
          <View style={{ flexDirection: 'row', gap: 14, flexWrap: 'wrap' }}>
            <Icon3D icon="plus" color="#0d9488" />
            <Icon3D icon="exchange" color="#ea580c" />
            <Icon3D icon="comment" color="#e11d48" />
            <Icon3D icon="briefcase" color="#0891b2" />
            <Icon3D icon="pie-chart" color="#9333ea" />
            <Icon3D icon="bar-chart" color="#4f46e5" />
            <Icon3D icon="users" color="#d97706" />
            <Icon3D icon="ellipsis-h" color="#475569" />
          </View>
        </View>
      </ScrollView>
      <CustomTabBar
        {...({
          state: { index: 0, routes: [{ key: 'i', name: 'index' }, { key: 't', name: 'transactions' }, { key: 'r', name: 'reports' }] },
          navigation: { emit: () => ({ defaultPrevented: true }), navigate: () => undefined },
          descriptors: {},
          insets: { top: 0, bottom: 0, left: 0, right: 0 },
        } as any)}
      />
    </View>
  );
}
