import { Stack } from 'expo-router';
import { vars } from 'nativewind';
import React from 'react';
import { ScrollView, Text, View } from 'react-native';

import AuroraBackground from '@/components/aurora/AuroraBackground';
import CustomTabBar from '@/components/CustomTabBar';
import { AURORA_VARS } from '@/components/aurora/palette';

/**
 * Developer-only lab for the Aurora theme: the same dark-mode markup, as the
 * screens write it, rendered with and without the Aurora palette override.
 * Not reachable from the app; production builds render nothing.
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
      <ScrollView contentContainerStyle={{ padding: 20, gap: 28, paddingBottom: 80 }}>
        <View className="bg-background-dark p-4 rounded-3xl gap-3">
          <Sample label="Today (no override)" />
        </View>
        <View style={auroraStyle} className="bg-background-dark p-4 rounded-3xl gap-3">
          <Sample label="Aurora (vars override)" />
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
