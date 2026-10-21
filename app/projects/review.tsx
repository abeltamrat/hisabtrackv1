import { useAppSettings } from '@/contexts/AppSettingsContext';
import type { RootState } from '@/store';
import { projectReviewIssues } from '@/utils/projectReview';
import { FontAwesome } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useSelector } from 'react-redux';

type ReviewFilter = 'ALL' | 'INCOMPLETE' | 'SUGGESTED';

export default function ProjectReviewScreen() {
  const router = useRouter();
  const { formatCurrency } = useAppSettings();
  const transactions = useSelector((state: RootState) => state.transactions.items);
  const accounts = useSelector((state: RootState) => state.accounts.items);
  const [filter, setFilter] = useState<ReviewFilter>('ALL');
  const issues = useMemo(() => projectReviewIssues(transactions), [transactions]);
  const visible = issues.filter(issue => filter === 'ALL' || (filter === 'SUGGESTED' ? issue.suggested : !issue.suggested));

  return <View className="flex-1 bg-slate-50 dark:bg-background-dark">
    <Stack.Screen options={{ headerShown: false }} />
    <View className="px-5 pt-5 pb-4 flex-row items-center">
      <TouchableOpacity accessibilityLabel="Go back" onPress={() => router.back()} className="w-11 h-11 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 items-center justify-center"><FontAwesome name="arrow-left" size={16} color="#64748b" /></TouchableOpacity>
      <View className="flex-1 ml-4"><Text className="text-xl font-extrabold text-slate-900 dark:text-white">Project cost review</Text><Text className="text-xs text-slate-500 dark:text-slate-400">Complete missing Mela details</Text></View>
    </View>
    <View className="px-5">
      <View className="rounded-2xl p-4 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900 mb-3"><Text className="text-xs text-indigo-800 dark:text-indigo-200 leading-5">Suggested rows look project-related but have no Mela link. Incomplete rows already contain a project, item, or supplier and are missing related details. Review each before changing it.</Text></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-3">{([['ALL','All'],['INCOMPLETE','Incomplete'],['SUGGESTED','Suggested']] as [ReviewFilter,string][]).map(([value,label])=><TouchableOpacity key={value} onPress={()=>setFilter(value)} className={`mr-2 px-4 py-2 rounded-full ${filter===value?'bg-indigo-600':'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700'}`}><Text className={`text-xs font-bold ${filter===value?'text-white':'text-slate-600 dark:text-slate-300'}`}>{label}</Text></TouchableOpacity>)}</ScrollView>
    </View>
    <ScrollView className="flex-1 px-5" contentContainerStyle={{ paddingBottom: 36 }}>
      {visible.map(issue => { const tx=issue.transaction; const account=accounts.find(item=>item.id===tx.account_id)?.name; return <TouchableOpacity key={tx.id} onPress={()=>router.push(`/transaction/${tx.id}` as any)} className="p-4 mb-3 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
        <View className="flex-row items-start"><View className={`w-10 h-10 rounded-xl items-center justify-center mr-3 ${issue.suggested?'bg-amber-100 dark:bg-amber-950':'bg-red-100 dark:bg-red-950'}`}><FontAwesome name={issue.suggested?'lightbulb-o':'exclamation'} size={16} color={issue.suggested?'#d97706':'#dc2626'} /></View><View className="flex-1"><Text numberOfLines={1} className="font-extrabold text-slate-900 dark:text-white">{tx.description}</Text><Text className="text-xs text-slate-500 dark:text-slate-400 mt-1">{new Date(tx.date).toLocaleDateString()}{account?` · ${account}`:''} · {tx.category}</Text></View><Text className="font-extrabold text-red-600">-{formatCurrency(tx.amount)}</Text></View>
        <View className="flex-row flex-wrap mt-3">{issue.missing.map(value=><View key={value} className="mr-2 mb-1 px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-700"><Text className="text-[10px] font-bold text-slate-600 dark:text-slate-300">Missing {value}</Text></View>)}</View>
        <Text className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 mt-2">Open transaction to complete details →</Text>
      </TouchableOpacity>; })}
      {!visible.length && <View className="items-center py-20"><FontAwesome name="check-circle" size={44} color="#10b981" /><Text className="text-lg font-extrabold text-slate-900 dark:text-white mt-4">Nothing needs review</Text><Text className="text-sm text-slate-500 dark:text-slate-400 text-center mt-2">Project transactions in this view have complete Mela details.</Text></View>}
    </ScrollView>
  </View>;
}
