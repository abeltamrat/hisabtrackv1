import CoinLoader from '@/components/CoinLoader';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from '@/components/aurora/AuroraGradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { useTheme } from '@/contexts/ThemeContext';
import { getDatabase } from '@/services/database';
import Phase2IntelligenceService, { type Phase2ReviewSnapshot } from '@/services/Phase2IntelligenceService';
import RecipientIdentityService from '@/services/RecipientIdentityService';
import { RecurringTransactionService } from '@/services/RecurringTransactionService';
import SmartReviewService from '@/services/SmartReviewService';
import { Alert } from '@/utils/alert';

type Tab = 'ALERTS' | 'RECURRING' | 'RECIPIENTS' | 'COVERAGE';
const empty: Phase2ReviewSnapshot = { smsAlerts: [], recurringAlerts: [], recipientSuggestions: [], recipientProfiles: [] };
const coverage = [
  ['CBE', 'Transfers, credits, withdrawals, itemized charges, masked accounts, receipt links'],
  ['Telebirr', 'Cash in/out, person and merchant payments, packages, loans, bank-wallet transfers'],
  ['Bank of Abyssinia', 'Credits, debits, masked accounts, balances and receipt references'],
  ['Awash', 'Credits, withdrawals, own/other-bank transfers, fees, VAT and receipts'],
  ['Dashen', 'Generic credits, debits, transfers, charges, references and balances'],
] as const;

export default function SmartReviewScreen() {
  const router = useRouter();
  const { actualTheme } = useTheme();
  const [tab, setTab] = useState<Tab>('ALERTS');
  const [snapshot, setSnapshot] = useState<Phase2ReviewSnapshot>(empty);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [moveDates, setMoveDates] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const db = await getDatabase();
    const [transactions, accounts] = await Promise.all([db.getTransactions(), db.getAccounts()]);
    setSnapshot(await Phase2IntelligenceService.analyze(transactions, accounts));
  }, []);
  useEffect(() => { void load().finally(() => setLoading(false)); }, [load]);
  const refresh = async () => { setRefreshing(true); try { await load(); } finally { setRefreshing(false); } };
  const run = async (action: () => Promise<unknown>, success: string) => {
    try { await action(); await load(); Alert.alert('Saved', success); } catch (error: any) { Alert.alert('Could not save', error?.message || 'Try again.'); }
  };

  const Card = ({ children }: { children: React.ReactNode }) => <View className="bg-white dark:bg-slate-800 rounded-2xl p-4 mb-3 border border-slate-200 dark:border-slate-700">{children}</View>;
  const Button = ({ label, onPress, tone = 'indigo' }: { label: string; onPress: () => void; tone?: 'indigo' | 'slate' | 'red' | 'green' }) => {
    const classes = tone === 'red' ? 'bg-red-600' : tone === 'green' ? 'bg-emerald-600' : tone === 'slate' ? 'bg-slate-200 dark:bg-slate-700' : 'bg-indigo-600';
    return <TouchableOpacity onPress={onPress} className={`${classes} rounded-xl px-3 py-2 mr-2 mt-2`}><Text className={`${tone === 'slate' ? 'text-slate-800 dark:text-white' : 'text-white'} text-xs font-bold`}>{label}</Text></TouchableOpacity>;
  };

  return <View className="flex-1 bg-slate-50 dark:bg-background-dark">
    <StatusBar style="auto" />
    <LinearGradient colors={actualTheme === 'dark' ? ['#312e81', '#0f172a'] : ['#4f46e5', '#7c3aed']} className="px-5 pt-6 pb-6 rounded-b-[28px]">
      <View className="flex-row items-center"><TouchableOpacity accessibilityLabel="Go back" onPress={() => router.back()} className="w-10 h-10 bg-white/20 rounded-xl items-center justify-center"><FontAwesome name="arrow-left" size={17} color="white" /></TouchableOpacity><View className="ml-3 flex-1"><Text className="text-white text-2xl font-bold">Smart Review</Text><Text className="text-indigo-100 text-xs mt-1">Evidence first. Nothing is changed automatically.</Text></View></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-5">{(['ALERTS', 'RECURRING', 'RECIPIENTS', 'COVERAGE'] as Tab[]).map(item => <TouchableOpacity key={item} onPress={() => setTab(item)} className={`px-3 py-2 rounded-xl mr-2 ${tab === item ? 'bg-white' : 'bg-white/15'}`}><Text className={`text-xs font-bold ${tab === item ? 'text-indigo-700' : 'text-white'}`}>{item}</Text></TouchableOpacity>)}</ScrollView>
    </LinearGradient>
    {loading ? <View className="flex-1 items-center justify-center"><CoinLoader size="large" color="#6366f1" /></View> : <ScrollView className="flex-1 px-5 pt-5" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      {tab === 'ALERTS' && <>
        <Text className="text-slate-900 dark:text-white font-bold text-lg mb-1">SMS charge and debit checks</Text><Text className="text-slate-500 dark:text-slate-400 text-sm mb-4">Flags require comparable history. Refunds and reversals are excluded.</Text>
        {!snapshot.smsAlerts.length && <Card><Text className="text-slate-600 dark:text-slate-300">No unusual SMS charges or likely duplicate debits need review.</Text></Card>}
        {snapshot.smsAlerts.map(alert => <Card key={alert.id}><View className="flex-row"><FontAwesome name={alert.severity === 'WARNING' ? 'exclamation-triangle' : 'info-circle'} size={18} color={alert.severity === 'WARNING' ? '#dc2626' : '#2563eb'} /><View className="ml-3 flex-1"><Text className="text-slate-900 dark:text-white font-bold">{alert.title}</Text><Text className="text-slate-600 dark:text-slate-300 text-sm mt-2">{alert.explanation}</Text>{alert.baseline && <Text className="text-slate-500 dark:text-slate-400 text-xs mt-2">Baseline: {alert.baseline.samples} supporting records · {alert.baseline.label}</Text>}<View className="flex-row flex-wrap"><Button label="Review SMS" onPress={() => router.push({ pathname: '/draft-transactions', params: { draftId: alert.draftId } } as any)} /><Button label={`Evidence (${alert.supportingIds.length + 1})`} tone="slate" onPress={() => router.push({ pathname: '/draft-transactions', params: { evidenceIds: [alert.draftId, ...alert.supportingIds].join(',') } } as any)} /><Button label="Expected" tone="green" onPress={() => void run(() => SmartReviewService.setAlertFeedback(alert.id, 'EXPECTED'), 'This alert was marked expected.')} /><Button label="Dismiss" tone="slate" onPress={() => void run(() => SmartReviewService.setAlertFeedback(alert.id, 'DISMISSED'), 'Alert dismissed.')} /></View></View></View></Card>)}
      </>}
      {tab === 'RECURRING' && <>
        <Text className="text-slate-900 dark:text-white font-bold text-lg mb-1">Expected payments</Text><Text className="text-slate-500 dark:text-slate-400 text-sm mb-4">“Not recorded” never claims the bank payment failed. Recording cash remains a separate action.</Text>
        {!snapshot.recurringAlerts.length && <Card><Text className="text-slate-600 dark:text-slate-300">No changed or overdue recurring items need review.</Text></Card>}
        {snapshot.recurringAlerts.map(alert => <Card key={alert.id}><Text className="text-slate-900 dark:text-white font-bold">{alert.title}</Text><Text className="text-slate-600 dark:text-slate-300 text-sm mt-2">{alert.explanation}</Text><Text className="text-slate-500 dark:text-slate-400 text-xs mt-2">Expected {new Date(alert.expectedDate).toLocaleDateString()} · grace {alert.graceDays} day{alert.graceDays === 1 ? '' : 's'}</Text>{alert.kind === 'CHANGED_AMOUNT' && alert.observedAmount && <Button label={`Use ETB ${alert.observedAmount.toFixed(2)} next time`} tone="green" onPress={() => void run(async () => { await RecurringTransactionService.settleObservedOccurrence(alert.recurringId, alert.expectedDate, alert.observedAmount!); await SmartReviewService.setRecurringDecision(alert.id, 'AMOUNT_ACCEPTED'); }, 'Observed occurrence matched and future amount updated; no transaction was posted.')} />}<View className="flex-row flex-wrap"><Button label="Open recurring" onPress={() => router.push('/recurring' as any)} /><Button label="Skip once" tone="slate" onPress={() => void run(async () => { await RecurringTransactionService.skipOccurrence(alert.recurringId); await SmartReviewService.setRecurringDecision(alert.id, 'SKIPPED'); }, 'Occurrence skipped without posting money.')} /><Button label="Pause" tone="red" onPress={() => void run(() => RecurringTransactionService.pause(alert.recurringId), 'Recurring rule paused.')} /></View><View className="flex-row items-center mt-2"><TextInput value={moveDates[alert.id] || ''} onChangeText={value => setMoveDates(current => ({ ...current, [alert.id]: value }))} placeholder="YYYY-MM-DD" placeholderTextColor="#94a3b8" className="flex-1 bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-white rounded-xl px-3 py-2" /><Button label="Move date" onPress={() => void run(async () => { const value = new Date(`${moveDates[alert.id]}T12:00:00`).getTime(); await RecurringTransactionService.moveExpectedDate(alert.recurringId, value); await SmartReviewService.setRecurringDecision(alert.id, 'MOVED'); }, 'Expected date moved without posting money.')} /></View></Card>)}
      </>}
      {tab === 'RECIPIENTS' && <>
        <Text className="text-slate-900 dark:text-white font-bold text-lg mb-1">Recipient aliases</Text><Text className="text-slate-500 dark:text-slate-400 text-sm mb-4">Only confirmed aliases share history and learned category/tag defaults. Owned-account names stay separate.</Text>
        {!snapshot.recipientSuggestions.length && <Card><Text className="text-slate-600 dark:text-slate-300">No recipient merges are suggested.</Text></Card>}
        {snapshot.recipientSuggestions.map(suggestion => <Card key={suggestion.id}><Text className="text-slate-900 dark:text-white font-bold">{suggestion.left} ↔ {suggestion.right}</Text><Text className="text-slate-600 dark:text-slate-300 text-sm mt-2">{suggestion.reason} Confidence {suggestion.confidence}%.</Text><Button label={`Merge as ${suggestion.right}`} tone="green" onPress={() => void run(() => RecipientIdentityService.confirmMerge(suggestion.right, [suggestion.left, suggestion.right], suggestion.hints), 'Aliases merged. Raw SMS evidence was not changed.')} /></Card>)}
        {snapshot.recipientProfiles.map(profile => <Card key={profile.id}><Text className="text-slate-900 dark:text-white font-bold">{profile.displayName}</Text><Text className="text-slate-500 dark:text-slate-400 text-xs mt-1">{profile.verifiedHints.length ? profile.verifiedHints.join(' · ') : 'No verified phone/account hint'}</Text><View className="flex-row flex-wrap mt-2">{profile.aliases.map(alias => <TouchableOpacity key={alias} onPress={() => void run(() => RecipientIdentityService.unmerge(profile.id, alias), `${alias} was separated.`)} className="bg-violet-100 dark:bg-violet-900/30 px-3 py-2 rounded-full mr-2 mb-2"><Text className="text-violet-800 dark:text-violet-200 text-xs">{alias} ×</Text></TouchableOpacity>)}</View></Card>)}
      </>}
      {tab === 'COVERAGE' && <><Text className="text-slate-900 dark:text-white font-bold text-lg mb-1">SMS parser coverage</Text><Text className="text-slate-500 dark:text-slate-400 text-sm mb-4">Support is claimed by format and regression fixture, never by bank name alone.</Text>{coverage.map(([name, formats]) => <Card key={name}><Text className="text-slate-900 dark:text-white font-bold">{name}</Text><Text className="text-slate-600 dark:text-slate-300 text-sm mt-1">{formats}</Text></Card>)}<Card><Text className="text-slate-900 dark:text-white font-bold">Generic fallback</Text><Text className="text-slate-600 dark:text-slate-300 text-sm mt-1">Unknown senders use conservative credit/debit patterns. Account suffix checks prevent routing an SMS to an unrelated owned account.</Text></Card></>}
      <View className="h-10" />
    </ScrollView>}
  </View>;
}
