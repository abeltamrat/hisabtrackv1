import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useSelector } from 'react-redux';

import ScreenInfoCard from '@/components/ScreenInfoCard';
import { CreateFundSheet, InviteShareCard, JoinFundSheet } from '@/components/funds/FundInviteSheets';
import { FUND_GRADIENT, fundTypeLabel } from '@/components/funds/fundUi';
import { FUNDS_ENABLED } from '@/config/features';
import { useTransactions } from '@/context/TransactionContext';
import { useAppSettings } from '@/contexts/AppSettingsContext';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import FundSyncService, { type FundSnapshot } from '@/services/FundSyncService';
import { fundErrorMessage, fundRole, SharedFundService } from '@/services/SharedFundService';
import type { RootState } from '@/store';
import type { SharedFund } from '@/types/database';
import { sumMoney } from '@/utils/finance';
import { Alert } from '@/utils/alert';

export default function FundsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();
  const { user } = useAuth();
  const { actualTheme } = useTheme();
  const { formatCurrency, fontSize } = useAppSettings();
  const { categories } = useTransactions();
  const accounts = useSelector((state: RootState) => state.accounts.items);
  const [snapshot, setSnapshot] = useState<FundSnapshot>(FundSyncService.getSnapshot());
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(!!params.code);
  const [busyId, setBusyId] = useState<string | null>(null);
  const uid = user?.uid ?? '';
  const myName = user?.displayName || user?.email?.split('@')[0] || 'HisabTrack user';
  const headerTitleSize = fontSize === 'V.Small' ? 'text-base' : fontSize === 'Small' ? 'text-lg' : fontSize === 'Large' ? 'text-2xl' : 'text-xl';

  useEffect(() => {
    if (uid) FundSyncService.start(uid);
    return FundSyncService.subscribe(setSnapshot);
  }, [uid]);

  useEffect(() => { if (params.code) setShowJoin(true); }, [params.code]);

  const groups = useMemo(() => {
    const owned: SharedFund[] = [], held: SharedFund[] = [], invites: SharedFund[] = [];
    for (const fund of snapshot.funds) {
      const role = fundRole(fund, uid);
      if (role === 'OWNER') owned.push(fund);
      else if (role === 'CUSTODIAN') held.push(fund);
      else if (role === 'INVITEE' && fund.linkStatus === 'PENDING') invites.push(fund);
    }
    const order = (a: SharedFund, b: SharedFund) => Number(a.status === 'CLOSED') - Number(b.status === 'CLOSED') || b.updatedAt - a.updatedAt;
    return { owned: owned.sort(order), held: held.sort(order), invites };
  }, [snapshot.funds, uid]);

  const heldForMe = sumMoney(groups.owned.filter(fund => fund.status === 'ACTIVE').map(fund => fund.balance));
  const iHold = sumMoney(groups.held.filter(fund => fund.status === 'ACTIVE').map(fund => fund.balance));
  const currency = accounts[0]?.currency || 'ETB';

  const respond = async (fund: SharedFund, accept: boolean) => {
    if (accept && fund.currency !== currency) {
      Alert.alert('Different currency', `This fund is kept in ${fund.currency}, but your books use ${currency}. HisabTrack can only hold funds in your own currency.`);
      return;
    }
    setBusyId(fund.id);
    try {
      if (accept) {
        await SharedFundService.acceptInvite(fund.id, myName);
        router.push(`/fund/${fund.id}` as any);
      } else {
        await SharedFundService.decline(fund.id);
      }
    } catch (error) {
      Alert.alert('Could not update the invite', fundErrorMessage(error));
    } finally {
      setBusyId(null);
    }
  };

  if (!FUNDS_ENABLED) {
    return (
      <View className="flex-1 bg-slate-50 dark:bg-background-dark p-6">
        <Stack.Screen options={{ headerShown: false }} />
        <ScreenInfoCard icon="briefcase" title="Funds are coming soon" description="Shared petty cash and money held for you will be available in a later update." suggestions={[]} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-slate-50 dark:bg-background-dark">
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style="auto" />
      <LinearGradient colors={actualTheme === 'dark' ? FUND_GRADIENT.dark : FUND_GRADIENT.light} className="px-6 pt-6 pb-8 rounded-b-[32px]" style={{ elevation: 4 }}>
        <View className="flex-row justify-between items-center mb-4">
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} className="w-10 h-10 bg-white/20 rounded-xl justify-center items-center">
            <FontAwesome name="arrow-left" size={18} color="#fff" />
          </TouchableOpacity>
          <Text className={`text-white ${headerTitleSize} font-bold`}>Funds & Petty Cash</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="New fund" onPress={() => setShowCreate(true)} className="w-10 h-10 bg-white/20 rounded-xl justify-center items-center">
            <FontAwesome name="plus" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
        <View className="flex-row">
          <View className="flex-1 bg-white/10 rounded-2xl p-3 mr-2">
            <Text className="text-white/90 text-xs">Held for me</Text>
            <Text adjustsFontSizeToFit numberOfLines={1} minimumFontScale={0.6} className="text-white text-xl font-bold">{formatCurrency(heldForMe)}</Text>
          </View>
          <View className="flex-1 bg-white/10 rounded-2xl p-3 ml-2">
            <Text className="text-white/90 text-xs">I hold for others</Text>
            <Text adjustsFontSizeToFit numberOfLines={1} minimumFontScale={0.6} className="text-white text-xl font-bold">{formatCurrency(iHold)}</Text>
          </View>
        </View>
      </LinearGradient>

      <ScrollView className="flex-1 px-4 pt-5" contentContainerStyle={{ paddingBottom: 48 }}>
        {snapshot.error ? (
          <View className="rounded-2xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4 mb-4">
            <Text className="text-amber-800 dark:text-amber-200 text-sm font-semibold">{snapshot.error}</Text>
          </View>
        ) : null}

        {groups.invites.map(fund => (
          <View key={fund.id} className="rounded-3xl bg-white dark:bg-slate-800 border-2 border-teal-500 p-5 mb-4">
            <Text className="text-teal-700 dark:text-teal-300 text-xs font-bold uppercase mb-1">Invitation</Text>
            <Text className="text-slate-900 dark:text-white text-base font-bold">{fund.ownerName} wants you to hold "{fund.name}"</Text>
            <Text className="text-slate-500 dark:text-slate-400 text-xs mt-1 mb-4">
              {fundTypeLabel(fund.fundType)} · You record what comes in and what you pay from it. {fund.ownerName} sees only this fund, never your own accounts.
            </Text>
            <View className="flex-row gap-2">
              <TouchableOpacity accessibilityRole="button" disabled={busyId === fund.id} onPress={() => respond(fund, true)} className="flex-1 rounded-xl py-3 items-center bg-teal-600">
                <Text className="text-white font-bold">Accept</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" disabled={busyId === fund.id} onPress={() => respond(fund, false)} className="flex-1 rounded-xl py-3 items-center bg-slate-100 dark:bg-slate-700">
                <Text className="text-slate-700 dark:text-slate-200 font-bold">Decline</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}

        {snapshot.ready && groups.owned.length === 0 && groups.held.length === 0 && groups.invites.length === 0 && !snapshot.error && (
          <ScreenInfoCard
            icon="briefcase"
            title="Know where every birr goes"
            description="Give petty cash or a revolving float to someone you trust, or let people pay you through them. They record each payment, often straight from their bank SMS, and you see it live, with the receipt."
            suggestions={[
              'Tap + to create a fund and get an invite code.',
              'Send the code to your assistant by SMS, WhatsApp or Telegram.',
              'Their payments land in your reports under the right category.',
            ]}
          />
        )}

        <View className="flex-row gap-2 mb-5">
          <TouchableOpacity accessibilityRole="button" onPress={() => setShowCreate(true)} className="flex-1 flex-row items-center justify-center rounded-2xl py-3.5 bg-teal-600">
            <FontAwesome name="plus" size={13} color="#fff" />
            <Text className="text-white font-bold ml-2">New fund</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" onPress={() => setShowJoin(true)} className="flex-1 flex-row items-center justify-center rounded-2xl py-3.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            <FontAwesome name="key" size={13} color="#0d9488" />
            <Text className="text-slate-900 dark:text-white font-bold ml-2">Join with code</Text>
          </TouchableOpacity>
        </View>

        {groups.owned.length > 0 && <Text className="text-slate-500 dark:text-slate-400 text-xs font-bold uppercase mb-2 ml-1">Held for me</Text>}
        {groups.owned.map(fund => (
          <FundCard key={fund.id} fund={fund} role="OWNER" actionCount={(snapshot.actions[fund.id] || []).length} problem={snapshot.problems[fund.id]} formatCurrency={formatCurrency} onPress={() => router.push(`/fund/${fund.id}` as any)} myName={myName} />
        ))}

        {groups.held.length > 0 && <Text className="text-slate-500 dark:text-slate-400 text-xs font-bold uppercase mb-2 mt-3 ml-1">I hold for others</Text>}
        {groups.held.map(fund => (
          <FundCard key={fund.id} fund={fund} role="CUSTODIAN" actionCount={0} formatCurrency={formatCurrency} onPress={() => router.push(`/fund/${fund.id}` as any)} myName={myName} />
        ))}
      </ScrollView>

      <CreateFundSheet
        visible={showCreate}
        myName={myName}
        currency={currency}
        categories={categories}
        formatCurrency={formatCurrency}
        onClose={() => setShowCreate(false)}
        onCreated={fundId => { setShowCreate(false); router.push(`/fund/${fundId}` as any); }}
      />
      <JoinFundSheet
        visible={showJoin}
        myName={myName}
        initialCode={params.code}
        onClose={() => setShowJoin(false)}
        onJoined={fundId => { setShowJoin(false); router.push(`/fund/${fundId}` as any); }}
      />
    </View>
  );
}

function FundCard({ fund, role, actionCount, problem, formatCurrency, onPress, myName }: {
  fund: SharedFund;
  role: 'OWNER' | 'CUSTODIAN';
  actionCount: number;
  problem?: string;
  formatCurrency: (value: number) => string;
  onPress: () => void;
  myName: string;
}) {
  const counterpart = role === 'OWNER' ? fund.custodianName : fund.ownerName;
  const waiting = role === 'OWNER' && fund.linkStatus === 'PENDING';
  const progress = fund.floatTarget ? Math.max(0, Math.min(1, fund.balance / fund.floatTarget)) : null;
  const low = fund.floatTarget ? fund.balance < fund.floatTarget * fund.lowBalancePct / 100 : false;

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`${fund.name}, ${formatCurrency(fund.balance)}`}
      onPress={onPress}
      className="bg-white dark:bg-slate-800 rounded-3xl p-5 mb-3 border border-slate-100 dark:border-slate-700"
      style={{ elevation: 2, opacity: fund.status === 'CLOSED' ? 0.65 : 1 }}
    >
      <View className="flex-row items-start">
        <View className="w-11 h-11 rounded-2xl bg-teal-50 dark:bg-teal-900/30 items-center justify-center mr-3">
          <FontAwesome name={fund.fundType === 'HELD_FOR_ME' ? 'shield' : fund.fundType === 'REVOLVING' ? 'refresh' : 'money'} size={17} color="#0d9488" />
        </View>
        <View className="flex-1 mr-2">
          <Text className="text-slate-900 dark:text-white font-bold text-base" numberOfLines={1}>{fund.name}</Text>
          <Text className="text-slate-500 dark:text-slate-400 text-xs mt-0.5" numberOfLines={1}>
            {waiting ? `Waiting for ${fund.inviteEmailHint || 'them'} to join` : role === 'OWNER' ? `Held by ${counterpart || 'nobody yet'}` : `For ${counterpart}`}
            {fund.status === 'CLOSED' ? ' · Closed' : ''}
          </Text>
        </View>
        <View className="items-end">
          <Text adjustsFontSizeToFit numberOfLines={1} className={`font-bold text-lg ${fund.balance < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'}`}>{formatCurrency(fund.balance)}</Text>
          {fund.pendingIn > 0 && <Text className="text-amber-600 dark:text-amber-400 text-[11px]">+{formatCurrency(fund.pendingIn)} expected</Text>}
        </View>
      </View>
      {progress !== null && !waiting && (
        <View className="mt-4">
          <View className="h-2 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
            <View className={`h-2 rounded-full ${low ? 'bg-amber-500' : 'bg-teal-500'}`} style={{ width: `${Math.round(progress * 100)}%` }} />
          </View>
          <Text className="text-slate-500 dark:text-slate-400 text-[11px] mt-1">
            {low ? 'Running low · ' : ''}{formatCurrency(fund.balance)} of {formatCurrency(fund.floatTarget!)} float
          </Text>
        </View>
      )}
      {waiting && fund.inviteCode ? (
        <View className="mt-4">
          <InviteShareCard code={fund.inviteCode} ownerName={myName} fundName={fund.name} />
        </View>
      ) : null}
      {(actionCount > 0 || problem) && (
        <View className="flex-row items-center mt-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl px-3 py-2">
          <FontAwesome name="exclamation-circle" size={13} color="#6366f1" />
          <Text className="text-indigo-700 dark:text-indigo-300 text-xs font-semibold ml-2 flex-1" numberOfLines={2}>
            {problem || `${actionCount} ${actionCount === 1 ? 'entry needs' : 'entries need'} your answer`}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}
