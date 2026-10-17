import CoinLoader from '@/components/CoinLoader';
import { LinearGradient } from '@/components/aurora/AuroraGradient';
import { useAppSettings } from '@/contexts/AppSettingsContext';
import { useTheme } from '@/contexts/ThemeContext';
import DigitalAuditorService, { type AuditDecision, type AuditFinding, type AuditSeverity, type AuditSnapshot } from '@/services/DigitalAuditorService';
import { FontAwesome } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, Text, TouchableOpacity, View } from 'react-native';

type Filter = 'OPEN' | AuditSeverity | 'REVIEWED';

const severityStyle: Record<AuditSeverity, { color: string; background: string; icon: React.ComponentProps<typeof FontAwesome>['name']; label: string }> = {
  CRITICAL: { color: '#f87171', background: 'rgba(239,68,68,0.14)', icon: 'exclamation-triangle', label: 'Needs attention' },
  WARNING: { color: '#fbbf24', background: 'rgba(245,158,11,0.14)', icon: 'search', label: 'Review' },
  INFO: { color: '#60a5fa', background: 'rgba(59,130,246,0.14)', icon: 'info-circle', label: 'Information' },
};

export default function DigitalAuditorScreen() {
  const router = useRouter();
  const { actualTheme } = useTheme();
  const { formatCurrency } = useAppSettings();
  const [snapshot, setSnapshot] = useState<AuditSnapshot>();
  const [decisions, setDecisions] = useState<AuditDecision[]>([]);
  const [filter, setFilter] = useState<Filter>('OPEN');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [nextSnapshot, nextDecisions] = await Promise.all([DigitalAuditorService.analyze(), DigitalAuditorService.getDecisions()]);
    setSnapshot(nextSnapshot);
    setDecisions(nextDecisions);
  }, []);

  useEffect(() => { void load().finally(() => setLoading(false)); }, [load]);

  const decisionById = useMemo(() => new Map(decisions.map(item => [item.findingId, item])), [decisions]);
  const findings = useMemo(() => {
    if (!snapshot) return [];
    if (filter === 'REVIEWED') return snapshot.findings.filter(item => decisionById.has(item.id));
    const open = snapshot.findings.filter(item => !decisionById.has(item.id));
    return filter === 'OPEN' ? open : open.filter(item => item.severity === filter);
  }, [decisionById, filter, snapshot]);

  const setDecision = async (finding: AuditFinding, status: AuditDecision['status']) => {
    await DigitalAuditorService.setDecision(finding.id, status);
    setDecisions(await DigitalAuditorService.getDecisions());
  };

  const reopen = async (finding: AuditFinding) => {
    await DigitalAuditorService.reopen(finding.id);
    setDecisions(await DigitalAuditorService.getDecisions());
  };

  const refresh = async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  };

  const openFinding = (finding: AuditFinding) => router.push(finding.route as any);
  const openCount = snapshot?.findings.filter(item => !decisionById.has(item.id)).length || 0;
  const scoreColor = (snapshot?.score || 0) >= 90 ? '#34d399' : (snapshot?.score || 0) >= 70 ? '#fbbf24' : '#f87171';
  const cardClass = 'rounded-3xl border border-white/10 bg-slate-900/80 p-4 mb-3';

  return <View className="flex-1 bg-[#070b1d]">
    <StatusBar style="light" />
    <LinearGradient colors={actualTheme === 'dark' ? ['#312e81', '#061827'] : ['#4f46e5', '#0891b2']} className="px-5 pt-6 pb-7 rounded-b-[30px]">
      <View className="flex-row items-center">
        <TouchableOpacity accessibilityLabel="Go back" onPress={() => router.back()} className="w-11 h-11 rounded-2xl bg-white/15 items-center justify-center">
          <FontAwesome name="arrow-left" size={18} color="white" />
        </TouchableOpacity>
        <View className="flex-1 ml-3">
          <Text className="text-white text-2xl font-bold">AI Digital Auditor</Text>
          <Text className="text-indigo-100 text-xs mt-1">Independent checks with evidence. You approve every correction.</Text>
        </View>
        <View className="w-12 h-12 rounded-2xl bg-white/15 items-center justify-center"><FontAwesome name="shield" size={24} color="#a7f3d0" /></View>
      </View>

      {snapshot && <View className="flex-row mt-6">
        <View className="flex-1 rounded-2xl bg-black/20 p-4 mr-2">
          <Text className="text-indigo-100 text-xs">LEDGER CONFIDENCE</Text>
          <Text style={{ color: scoreColor }} className="text-3xl font-extrabold mt-1">{snapshot.score}/100</Text>
          <Text className="text-white/90 text-[11px] mt-1">Based on record integrity, not financial health</Text>
        </View>
        <View className="flex-1 rounded-2xl bg-black/20 p-4 ml-2">
          <Text className="text-indigo-100 text-xs">OPEN FINDINGS</Text>
          <Text className="text-white text-3xl font-extrabold mt-1">{openCount}</Text>
          <Text className="text-white/90 text-[11px] mt-1">{snapshot.recordsReviewed} records checked</Text>
        </View>
      </View>}
    </LinearGradient>

    {loading || !snapshot ? <View className="flex-1 items-center justify-center"><CoinLoader size="large" color="#8b5cf6" /><Text className="text-slate-200 mt-4">Auditing your records…</Text></View> : <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-grow-0 px-5 pt-4" contentContainerStyle={{ paddingRight: 28 }}>
        {(['OPEN', 'CRITICAL', 'WARNING', 'REVIEWED'] as Filter[]).map(item => {
          const label = item === 'OPEN' ? `Open ${openCount}` : item === 'CRITICAL' ? `Attention ${snapshot.counts.CRITICAL}` : item === 'WARNING' ? `Review ${snapshot.counts.WARNING}` : `Reviewed ${decisions.filter(decision => snapshot.findings.some(finding => finding.id === decision.findingId)).length}`;
          return <TouchableOpacity key={item} onPress={() => setFilter(item)} className={`rounded-xl px-4 py-2 mr-2 border ${filter === item ? 'bg-violet-600 border-violet-400' : 'bg-slate-900 border-slate-700'}`}><Text className="text-white text-xs font-bold">{label}</Text></TouchableOpacity>;
        })}
      </ScrollView>

      <ScrollView className="flex-1 px-5 pt-4" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#8b5cf6" />}>
        <View className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-4 mb-4 flex-row">
          <FontAwesome name="lock" size={17} color="#34d399" />
          <Text className="text-emerald-100 text-xs leading-5 ml-3 flex-1">The auditor is read-only. A finding is a request to review evidence, not an accusation of fraud or proof that a payment failed.</Text>
        </View>

        {!findings.length && <View className={cardClass}>
          <View className="w-12 h-12 rounded-2xl bg-emerald-500/15 items-center justify-center mb-3"><FontAwesome name="check-circle" size={25} color="#34d399" /></View>
          <Text className="text-white text-lg font-bold">{filter === 'REVIEWED' ? 'No reviewed findings' : 'No findings in this view'}</Text>
          <Text className="text-slate-200 text-sm leading-5 mt-2">{filter === 'OPEN' ? 'The current checks found no unresolved duplicate, transfer, balance, classification, or obligation issue.' : 'Choose another filter or pull down to run the audit again.'}</Text>
        </View>}

        {findings.map(finding => {
          const style = severityStyle[finding.severity];
          const decision = decisionById.get(finding.id);
          return <View key={finding.id} className={cardClass}>
            <View className="flex-row items-start">
              <View style={{ backgroundColor: style.background }} className="w-11 h-11 rounded-2xl items-center justify-center"><FontAwesome name={style.icon} size={19} color={style.color} /></View>
              <View className="flex-1 ml-3">
                <View className="flex-row items-center flex-wrap"><Text style={{ color: style.color }} className="text-[10px] font-bold tracking-wider mr-2">{style.label.toUpperCase()}</Text><Text className="text-slate-200 text-[10px]">{finding.area}</Text></View>
                <Text className="text-white text-base font-bold mt-1">{finding.title}</Text>
                {finding.amount !== undefined && finding.amount > 0 && <Text className="text-white text-xl font-extrabold mt-2">{formatCurrency(finding.amount)}</Text>}
              </View>
            </View>
            <Text className="text-slate-200 text-sm leading-5 mt-4">{finding.explanation}</Text>
            <View className="bg-slate-800/80 rounded-2xl p-3 mt-3"><Text className="text-violet-300 text-[10px] font-bold mb-1">RECOMMENDED CHECK</Text><Text className="text-slate-200 text-xs leading-5">{finding.recommendation}</Text></View>
            <Text className="text-slate-200 text-[10px] mt-3">{finding.evidenceIds.length} supporting record{finding.evidenceIds.length === 1 ? '' : 's'}</Text>
            <View className="flex-row flex-wrap mt-2">
              <TouchableOpacity onPress={() => openFinding(finding)} className="bg-violet-600 rounded-xl px-4 py-3 mr-2 mt-2"><Text className="text-white text-xs font-bold">Review evidence</Text></TouchableOpacity>
              {decision ? <TouchableOpacity onPress={() => void reopen(finding)} className="bg-slate-700 rounded-xl px-4 py-3 mt-2"><Text className="text-white text-xs font-bold">Reopen</Text></TouchableOpacity> : <>
                <TouchableOpacity onPress={() => void setDecision(finding, 'ACKNOWLEDGED')} className="bg-emerald-600 rounded-xl px-4 py-3 mr-2 mt-2"><Text className="text-white text-xs font-bold">Acknowledged</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => void setDecision(finding, 'FALSE_ALARM')} className="bg-slate-700 rounded-xl px-4 py-3 mt-2"><Text className="text-white text-xs font-bold">False alarm</Text></TouchableOpacity>
              </>}
            </View>
            {decision && <Text className="text-slate-200 text-[11px] mt-3">Marked {decision.status === 'FALSE_ALARM' ? 'false alarm' : 'acknowledged'} on {new Date(decision.at).toLocaleDateString()}.</Text>}
          </View>;
        })}
        <View className="h-10" />
      </ScrollView>
    </>}
  </View>;
}
