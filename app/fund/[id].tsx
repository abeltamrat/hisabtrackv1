import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from '@/components/aurora/AuroraGradient';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';

import FormField from '@/components/FormField';
import FormSheet from '@/components/FormSheet';
import FundEntryRow from '@/components/funds/FundEntryRow';
import FundEntrySheet, { type FundEntryMode, type FundEntryPrefill } from '@/components/funds/FundEntrySheet';
import { InviteShareCard } from '@/components/funds/FundInviteSheets';
import FundReviewSheet from '@/components/funds/FundReviewSheet';
import { FUND_GRADIENT, formatDay, fundTypeLabel, getCustodianAccount, rootCategory, setCustodianAccount, snapshotCategories } from '@/components/funds/fundUi';
import { useTransactions } from '@/context/TransactionContext';
import { useAppSettings } from '@/contexts/AppSettingsContext';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useFormErrors } from '@/hooks/useFormErrors';
import FundPostingService, { type FundPostingJob } from '@/services/FundPostingService';
import FundSyncService, { type FundSnapshot } from '@/services/FundSyncService';
import { fundErrorMessage, fundRole, SharedFundService } from '@/services/SharedFundService';
import type { AppDispatch, RootState } from '@/store';
import { addAccount, fetchAccounts } from '@/store/slices/accountsSlice';
import { fetchTransactions } from '@/store/slices/transactionsSlice';
import type { Account, FundChangelogEntry, FundEntry, SharedFund } from '@/types/database';
import { Alert } from '@/utils/alert';
import { money, sumMoney } from '@/utils/finance';

type Tab = 'activity' | 'summary' | 'log';

export default function FundDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const dispatch = useDispatch<AppDispatch>();
  const { user } = useAuth();
  const { actualTheme } = useTheme();
  const { formatCurrency } = useAppSettings();
  const { categories } = useTransactions();
  const accounts = useSelector((state: RootState) => state.accounts.items);
  const uid = user?.uid ?? '';

  const [fund, setFund] = useState<SharedFund | null | undefined>(undefined);
  const [entries, setEntries] = useState<FundEntry[]>([]);
  const [log, setLog] = useState<FundChangelogEntry[]>([]);
  const [problem, setProblem] = useState('');
  const [tab, setTab] = useState<Tab>('activity');
  const [sheet, setSheet] = useState<{ mode: FundEntryMode; prefill?: FundEntryPrefill } | null>(null);
  const [reviewing, setReviewing] = useState<FundEntry | null>(null);
  const [jobs, setJobs] = useState<FundPostingJob[]>([]);
  const [custodianAccountId, setCustodianAccountId] = useState<string | undefined>();
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [sync, setSync] = useState<FundSnapshot>(FundSyncService.getSnapshot());
  const [notice, setNotice] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [newCode, setNewCode] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const stopFund = SharedFundService.listenToFund(id, setFund, error => { setProblem(fundErrorMessage(error)); setFund(null); });
    const stopEntries = SharedFundService.listenToEntries(id, 300, setEntries, error => setProblem(fundErrorMessage(error)));
    return () => { stopFund(); stopEntries(); };
  }, [id]);

  useEffect(() => {
    if (!id || tab !== 'log') return;
    return SharedFundService.listenToChangelog(id, setLog, error => setProblem(fundErrorMessage(error)));
  }, [id, tab]);

  useEffect(() => {
    if (uid) FundSyncService.start(uid);
    return FundSyncService.subscribe(setSync);
  }, [uid]);

  const role = fund ? fundRole(fund, uid) : null;
  const isOwner = role === 'OWNER';
  const ledgerCurrency = accounts[0]?.currency || 'ETB';

  const loadLocal = useCallback(async () => {
    if (!id) return;
    try {
      setJobs(await FundPostingService.getJobs(id));
      setCustodianAccountId(await getCustodianAccount(id));
    } catch { /* local state is optional */ }
    setPrefsLoaded(true);
  }, [id]);
  useFocusEffect(useCallback(() => { void loadLocal(); }, [loadLocal]));
  useEffect(() => { void loadLocal(); }, [entries, loadLocal]);

  // Keep the owner's books and the custodian's category list current.
  useEffect(() => {
    if (!fund || !isOwner) return;
    void FundSyncService.refresh(fund);
    const snapshot = snapshotCategories(categories);
    if (categories.length && JSON.stringify(snapshot) !== JSON.stringify(fund.categories)) {
      void SharedFundService.update(fund.id, { categories: snapshot }).catch(() => undefined);
    }
  }, [fund?.id, isOwner]); // eslint-disable-line react-hooks/exhaustive-deps

  const tagSuggestions = useMemo(() => [...new Set(entries.flatMap(entry => entry.tags || []))], [entries]);
  const actions = (fund && sync.actions[fund.id]) || [];
  const failedJobs = jobs.filter(job => job.status === 'failed');
  const waitingJobs = jobs.filter(job => job.status === 'pending');

  const say = (message: string) => {
    setNotice(message);
    setSheet(null);
    setReviewing(null);
    void loadLocal();
  };

  const manage = async (work: () => Promise<unknown>, message: string) => {
    try {
      await work();
      say(message);
    } catch (error) {
      Alert.alert('Could not update the fund', fundErrorMessage(error));
    }
  };

  const createCustodianAccount = async () => {
    if (!fund) return;
    try {
      const created = await dispatch(addAccount({
        name: `Fund – ${fund.ownerName}`.slice(0, 60), type: 'CASH', balance: 0, currency: ledgerCurrency,
        is_locked: false, locked_amount: 0, fund_id: fund.id,
      } as Omit<Account, 'id' | 'created_at'>)).unwrap();
      await setCustodianAccount(fund.id, created.id);
      setCustodianAccountId(created.id);
      void dispatch(fetchAccounts());
    } catch (error) {
      Alert.alert('Could not create the account', fundErrorMessage(error));
    }
  };

  if (fund === undefined) {
    return (
      <View className="flex-1 bg-slate-50 dark:bg-background-dark items-center justify-center">
        <Stack.Screen options={{ headerShown: false }} />
        <Text className="text-slate-500 dark:text-slate-400">Opening fund…</Text>
      </View>
    );
  }

  if (!fund || !role) {
    return (
      <View className="flex-1 bg-slate-50 dark:bg-background-dark p-6 justify-center">
        <Stack.Screen options={{ headerShown: false }} />
        <Text className="text-slate-900 dark:text-white text-lg font-bold mb-2">This fund isn't available</Text>
        <Text className="text-slate-500 dark:text-slate-400 mb-6">{problem || 'It may have been closed, or you are no longer part of it.'}</Text>
        <TouchableOpacity accessibilityRole="button" onPress={() => router.replace('/funds' as any)} className="rounded-2xl py-4 items-center bg-teal-600">
          <Text className="text-white font-bold">Back to funds</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const holder = fund.custodianName || 'the custodian';
  const active = fund.status === 'ACTIVE' && fund.linkStatus === 'ACCEPTED';
  const currencyMismatch = role === 'CUSTODIAN' && fund.currency !== ledgerCurrency;
  const refill = fund.floatTarget ? money(fund.floatTarget - fund.balance) : 0;
  const myAccounts = accounts.filter(account => !(isOwner && account.fund_id === fund.id));
  const actionEntry = (entryId: string) => entries.find(entry => entry.id === entryId) || null;

  return (
    <View className="flex-1 bg-slate-50 dark:bg-background-dark">
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style="auto" />
      <LinearGradient colors={actualTheme === 'dark' ? FUND_GRADIENT.dark : FUND_GRADIENT.light} className="px-6 pt-6 pb-7 rounded-b-[32px]" style={{ elevation: 4 }}>
        <View className="flex-row justify-between items-center mb-4">
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} className="w-10 h-10 bg-white/20 rounded-xl justify-center items-center">
            <FontAwesome name="arrow-left" size={18} color="#fff" />
          </TouchableOpacity>
          <View className="flex-1 mx-3 items-center">
            <Text className="text-white text-lg font-bold" numberOfLines={1}>{fund.name}</Text>
            <Text className="text-white/90 text-xs" numberOfLines={1}>
              {fundTypeLabel(fund.fundType)} · {isOwner ? `held by ${holder}` : `for ${fund.ownerName}`}{fund.status === 'CLOSED' ? ' · closed' : ''}
            </Text>
          </View>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fund settings" onPress={() => setShowSettings(true)} className="w-10 h-10 bg-white/20 rounded-xl justify-center items-center">
            <FontAwesome name="cog" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
        <Text className="text-white/90 text-xs">{isOwner ? `${holder} holds for you` : `You hold for ${fund.ownerName}`}</Text>
        <Text adjustsFontSizeToFit numberOfLines={1} minimumFontScale={0.5} className="text-white text-4xl font-bold mt-1">{formatCurrency(fund.balance)}</Text>
        {fund.balance < 0 && (
          <Text className="text-white text-xs font-semibold mt-1">
            {isOwner ? `You owe ${holder} ${formatCurrency(-fund.balance)}` : `${fund.ownerName} owes you ${formatCurrency(-fund.balance)}`}
          </Text>
        )}
        <View className="flex-row mt-4">
          <Stat label="In" value={formatCurrency(fund.totalIn)} />
          <Stat label="Spent" value={formatCurrency(fund.totalSpent)} />
          <Stat label="Returned" value={formatCurrency(fund.totalReturned)} />
        </View>
        {fund.pendingIn > 0 && <Text className="text-white text-xs font-semibold mt-3">+{formatCurrency(fund.pendingIn)} expected, not counted yet</Text>}
        {isOwner && fund.floatTarget && refill > 0 && active ? (
          <TouchableOpacity accessibilityRole="button" onPress={() => setSheet({ mode: 'send', prefill: { amount: refill } })} className="mt-4 bg-white rounded-xl py-2.5 flex-row items-center justify-center">
            <FontAwesome name="refresh" size={13} color="#0f766e" />
            <Text className="text-teal-800 font-bold text-sm ml-2">Send {formatCurrency(refill)} to restore the float</Text>
          </TouchableOpacity>
        ) : null}
      </LinearGradient>

      <ScrollView className="flex-1 px-4 pt-4" contentContainerStyle={{ paddingBottom: 56 }}>
        {notice ? (
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Dismiss message" onPress={() => setNotice('')} className="rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 p-3 mb-3 flex-row items-center">
            <FontAwesome name="check-circle" size={14} color="#059669" />
            <Text className="text-emerald-800 dark:text-emerald-200 text-xs font-semibold ml-2 flex-1">{notice}</Text>
          </TouchableOpacity>
        ) : null}
        {problem ? <Banner tone="warn" text={problem} /> : null}
        {isOwner && sync.problems[fund.id] ? <Banner tone="warn" text={`Your books could not be updated: ${sync.problems[fund.id]}`} /> : null}

        {fund.linkStatus === 'PENDING' && isOwner && (
          <View className="mb-4">
            <Text className="text-slate-900 dark:text-white font-bold mb-2">Waiting for someone to join</Text>
            {fund.inviteCode
              ? <InviteShareCard code={fund.inviteCode} ownerName={fund.ownerName} fundName={fund.name} emailHint={fund.inviteEmailHint} found={!!fund.invitedUid} />
              : <Banner tone="info" text="The invite code was used or expired. Get a new one in settings." />}
          </View>
        )}

        {currencyMismatch && (
          <Banner tone="warn" text={`This fund is in ${fund.currency} but your books use ${ledgerCurrency}, so you can't record it here. Leave the fund from settings and ask ${fund.ownerName} to set it up in ${ledgerCurrency}.`} />
        )}

        {role === 'CUSTODIAN' && active && prefsLoaded && !custodianAccountId && !currencyMismatch && (
          <View className="rounded-2xl bg-white dark:bg-slate-800 border border-teal-200 dark:border-teal-800 p-4 mb-4">
            <Text className="text-slate-900 dark:text-white font-bold mb-1">Where do you keep this money?</Text>
            <Text className="text-slate-500 dark:text-slate-400 text-xs mb-3">
              A separate cash account keeps {fund.ownerName}'s money apart from yours. If it arrives in your bank, pick that account instead. Either way, it stays out of your own reports.
            </Text>
            <TouchableOpacity accessibilityRole="button" onPress={createCustodianAccount} className="rounded-xl py-3 items-center bg-teal-600 mb-2">
              <Text className="text-white font-bold text-sm">Create "Fund – {fund.ownerName}" cash account</Text>
            </TouchableOpacity>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {accounts.map(account => (
                <TouchableOpacity key={account.id} accessibilityRole="button" onPress={() => { void setCustodianAccount(fund.id, account.id); setCustodianAccountId(account.id); }} className="mr-2 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                  <Text className="text-slate-700 dark:text-slate-300 text-xs font-semibold">Use {account.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {isOwner && actions.length > 0 && (
          <View className="mb-4">
            <Text className="text-slate-900 dark:text-white font-bold mb-2">Needs your answer</Text>
            {actions.map(action => (
              <TouchableOpacity key={`${action.kind}-${action.entryId}`} accessibilityRole="button" onPress={() => setReviewing(actionEntry(action.entryId))} className="flex-row items-center rounded-2xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 p-3 mb-2">
                <FontAwesome name={action.kind === 'CLASSIFY_DEPOSIT' ? 'question-circle' : 'bank'} size={15} color="#6366f1" />
                <Text className="text-indigo-900 dark:text-indigo-100 text-xs font-semibold flex-1 mx-2">{action.label}</Text>
                <Text className="text-indigo-700 dark:text-indigo-300 text-xs font-bold">{formatCurrency(action.amount)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {failedJobs.map(job => (
          <View key={job.id} className="rounded-2xl bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-4 mb-3">
            <Text className="text-rose-800 dark:text-rose-200 text-sm font-bold">Not added to the fund: {job.entry ? formatCurrency(job.entry.amount) : 'confirmation'}</Text>
            <Text className="text-rose-700 dark:text-rose-300 text-xs mt-1 mb-3">{job.error}</Text>
            <View className="flex-row gap-2">
              <TouchableOpacity accessibilityRole="button" onPress={() => manage(() => FundPostingService.retry(job.id), 'Sent again.')} className="flex-1 rounded-xl py-2.5 items-center bg-rose-600">
                <Text className="text-white font-bold text-xs">Try again</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" onPress={() => manage(async () => { await FundPostingService.keepAsPersonal(job.id); void dispatch(fetchTransactions()); void dispatch(fetchAccounts()); }, 'Kept as your own transaction.')} className="flex-1 rounded-xl py-2.5 items-center bg-white dark:bg-slate-800">
                <Text className="text-rose-700 dark:text-rose-300 font-bold text-xs">Keep as mine</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
        {waitingJobs.length > 0 && <Banner tone="info" text={`${waitingJobs.length} ${waitingJobs.length === 1 ? 'entry is' : 'entries are'} saved on this phone and will be shared when you're online.`} />}

        {active && !currencyMismatch && (
          <View className="flex-row flex-wrap gap-2 mb-4">
            {(isOwner
              ? [
                { mode: 'send' as const, label: 'Send money', icon: 'paper-plane' },
                { mode: 'expect' as const, label: 'Expect a deposit', icon: 'clock-o' },
                { mode: 'ownerReturn' as const, label: 'Got money back', icon: 'reply' },
              ]
              : [
                { mode: 'pay' as const, label: 'Record payment', icon: 'arrow-up' },
                { mode: 'received' as const, label: 'Money received', icon: 'arrow-down' },
                { mode: 'custodianReturn' as const, label: `Return to ${fund.ownerName}`, icon: 'reply' },
              ]).map(action => (
              <TouchableOpacity key={action.mode} accessibilityRole="button" onPress={() => setSheet({ mode: action.mode })} className="flex-row items-center px-4 py-3 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700" style={{ flexGrow: 1 }}>
                <FontAwesome name={action.icon as any} size={13} color="#0d9488" />
                <Text className="text-slate-900 dark:text-white font-bold text-xs ml-2" numberOfLines={1}>{action.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View className="flex-row bg-slate-100 dark:bg-slate-800 rounded-2xl p-1 mb-4">
          {(['activity', 'summary', 'log'] as Tab[]).map(item => (
            <TouchableOpacity key={item} accessibilityRole="tab" accessibilityState={{ selected: tab === item }} onPress={() => setTab(item)} className={`flex-1 py-2.5 rounded-xl items-center ${tab === item ? 'bg-white dark:bg-slate-700' : ''}`}>
              <Text className={`text-xs font-bold ${tab === item ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>{item === 'activity' ? 'Activity' : item === 'summary' ? 'Summary' : 'History'}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {tab === 'activity' && <Activity entries={entries} fund={fund} uid={uid} formatCurrency={formatCurrency} onOpen={setReviewing} />}
        {tab === 'summary' && <Summary entries={entries} fund={fund} formatCurrency={formatCurrency} />}
        {tab === 'log' && (
          log.length === 0
            ? <Text className="text-slate-500 dark:text-slate-400 text-sm text-center py-8">No history yet.</Text>
            : log.map(item => (
              <View key={item.id} className="flex-row py-2.5 border-b border-slate-100 dark:border-slate-800">
                <Text className="text-slate-500 dark:text-slate-400 text-[11px] w-24">{formatDay(item.timestamp)}</Text>
                <Text className="text-slate-900 dark:text-white text-xs flex-1"><Text className="font-bold">{item.actorUid === uid ? 'You' : item.actorName}</Text> · {item.action}</Text>
              </View>
            ))
        )}
      </ScrollView>

      {sheet && (
        <FundEntrySheet
          visible
          mode={sheet.mode}
          prefill={sheet.prefill}
          fund={fund}
          myUid={uid}
          accounts={myAccounts}
          defaultAccountId={isOwner ? undefined : custodianAccountId}
          tagSuggestions={tagSuggestions}
          fallbackCategories={categories}
          formatCurrency={formatCurrency}
          onClose={() => setSheet(null)}
          onSaved={say}
        />
      )}
      <FundReviewSheet
        entry={reviewing}
        fund={fund}
        myUid={uid}
        accounts={accounts}
        ownCategories={categories}
        defaultAccountId={custodianAccountId}
        formatCurrency={formatCurrency}
        onClose={() => setReviewing(null)}
        onDone={say}
      />
      <SettingsSheet
        visible={showSettings}
        fund={fund}
        role={role}
        newCode={newCode}
        formatCurrency={formatCurrency}
        onClose={() => { setShowSettings(false); setNewCode(null); }}
        onAction={(work, message) => manage(work, message)}
        onNewCode={async () => {
          try { setNewCode((await SharedFundService.reinvite(fund.id)).code); } catch (error) { Alert.alert('Could not create a code', fundErrorMessage(error)); }
        }}
        onLeft={() => { setShowSettings(false); router.replace('/funds' as any); }}
      />
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 bg-white/10 rounded-xl px-2.5 py-2 mr-2">
      <Text className="text-white/90 text-[10px]">{label}</Text>
      <Text adjustsFontSizeToFit numberOfLines={1} minimumFontScale={0.6} className="text-white text-sm font-bold">{value}</Text>
    </View>
  );
}

function Banner({ tone, text }: { tone: 'warn' | 'info'; text: string }) {
  return (
    <View className={`rounded-2xl p-3 mb-3 border ${tone === 'warn' ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800' : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}>
      <Text className={`text-xs font-semibold ${tone === 'warn' ? 'text-amber-800 dark:text-amber-200' : 'text-slate-700 dark:text-slate-300'}`}>{text}</Text>
    </View>
  );
}

function Activity({ entries, fund, uid, formatCurrency, onOpen }: {
  entries: FundEntry[]; fund: SharedFund; uid: string; formatCurrency: (value: number) => string; onOpen: (entry: FundEntry) => void;
}) {
  if (entries.length === 0) {
    return <Text className="text-slate-500 dark:text-slate-400 text-sm text-center py-8">Nothing recorded yet. Every payment and deposit will appear here.</Text>;
  }
  const days: Array<{ day: string; items: FundEntry[] }> = [];
  for (const entry of entries) {
    const day = formatDay(entry.date);
    if (days[days.length - 1]?.day !== day) days.push({ day, items: [] });
    days[days.length - 1].items.push(entry);
  }
  return (
    <>
      {days.map(group => (
        <View key={group.day} className="mb-3">
          <Text className="text-slate-500 dark:text-slate-400 text-xs font-bold mb-2 ml-1">{group.day}</Text>
          {group.items.map(entry => <FundEntryRow key={entry.id} entry={entry} fund={fund} myUid={uid} formatCurrency={formatCurrency} onPress={onOpen} />)}
        </View>
      ))}
    </>
  );
}

function Summary({ entries, fund, formatCurrency }: { entries: FundEntry[]; fund: SharedFund; formatCurrency: (value: number) => string }) {
  const counted = entries.filter(entry => entry.status === 'ACTIVE');
  const group = (items: FundEntry[], key: (entry: FundEntry) => string) => {
    const totals = new Map<string, number>();
    for (const item of items) totals.set(key(item), sumMoney([totals.get(key(item)) || 0, item.amount]));
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  };
  const spends = counted.filter(entry => entry.kind === 'SPEND');
  const weekStart = (timestamp: number) => {
    const date = new Date(timestamp);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    return date.getTime();
  };
  const weeks = group(spends.filter(entry => entry.date > Date.now() - 56 * 86400000), entry => String(weekStart(entry.date)))
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([key, total]) => [`Week of ${new Date(Number(key)).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`, total] as [string, number]);

  if (counted.length === 0) return <Text className="text-slate-500 dark:text-slate-400 text-sm text-center py-8">The summary appears once money moves.</Text>;
  return (
    <>
      <Breakdown title="Money in, by who paid" rows={group(counted.filter(entry => entry.kind === 'DEPOSIT'), entry => entry.payerName || fund.ownerName)} color="#059669" formatCurrency={formatCurrency} />
      <Breakdown title="Spent, by category" rows={group(spends, entry => rootCategory(fund.categories, entry.ownerCategory || entry.category || 'Uncategorized'))} color="#e11d48" formatCurrency={formatCurrency} />
      <Breakdown title="Spent, by who was paid" rows={group(spends, entry => entry.recipient || 'Not recorded')} color="#f59e0b" formatCurrency={formatCurrency} />
      <Breakdown title="Spent per week (last 8 weeks)" rows={weeks} color="#6366f1" formatCurrency={formatCurrency} />
      <Breakdown title="Returned" rows={group(counted.filter(entry => entry.kind === 'RETURN'), () => `To ${fund.ownerName}`)} color="#0d9488" formatCurrency={formatCurrency} />
    </>
  );
}

function Breakdown({ title, rows, color, formatCurrency }: { title: string; rows: Array<[string, number]>; color: string; formatCurrency: (value: number) => string }) {
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map(([, value]) => value));
  return (
    <View className="bg-white dark:bg-slate-800 rounded-2xl p-4 mb-3 border border-slate-100 dark:border-slate-700">
      <Text className="text-slate-900 dark:text-white font-bold text-sm mb-3">{title}</Text>
      {rows.slice(0, 8).map(([label, value]) => (
        <View key={label} className="mb-2.5">
          <View className="flex-row justify-between mb-1">
            <Text className="text-slate-700 dark:text-slate-300 text-xs flex-1 mr-2" numberOfLines={1}>{label}</Text>
            <Text className="text-slate-900 dark:text-white text-xs font-bold">{formatCurrency(value)}</Text>
          </View>
          <View className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
            <View className="h-1.5 rounded-full" style={{ width: `${Math.max(4, Math.round(value / max * 100))}%`, backgroundColor: color }} />
          </View>
        </View>
      ))}
    </View>
  );
}

function SettingsSheet({ visible, fund, role, newCode, formatCurrency, onClose, onAction, onNewCode, onLeft }: {
  visible: boolean;
  fund: SharedFund;
  role: 'OWNER' | 'CUSTODIAN' | 'INVITEE';
  newCode: string | null;
  formatCurrency: (value: number) => string;
  onClose: () => void;
  onAction: (work: () => Promise<unknown>, message: string) => void;
  onNewCode: () => void;
  onLeft: () => void;
}) {
  const { errors, validate, clearError } = useFormErrors<'name' | 'target'>();
  const [name, setName] = useState(fund.name);
  const [target, setTarget] = useState(fund.floatTarget ? String(fund.floatTarget) : '');
  useEffect(() => {
    if (!visible) return;
    setName(fund.name);
    setTarget(fund.floatTarget ? String(fund.floatTarget) : '');
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const isOwner = role === 'OWNER';
  const confirm = (title: string, message: string, label: string, onYes: () => void) =>
    Alert.alert(title, message, [{ text: 'Cancel', style: 'cancel' }, { text: label, style: 'destructive', onPress: onYes }]);

  const saveDetails = () => {
    const floatTarget = target.trim() ? Number(target.replace(',', '.')) : null;
    if (!validate({
      name: !name.trim() ? 'The fund needs a name.' : false,
      target: floatTarget !== null && !(floatTarget > 0) ? 'Enter the float amount, or leave it empty.' : false,
    })) return;
    onAction(() => SharedFundService.update(fund.id, { name: name.trim(), floatTarget }), 'Fund updated.');
    onClose();
  };

  return (
    <FormSheet visible={visible} onClose={onClose} accessibilityLabel="Fund settings">
      <View className="flex-row items-center justify-between mb-5">
        <Text className="text-slate-900 dark:text-white text-lg font-bold">Fund settings</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 items-center justify-center">
          <FontAwesome name="times" size={14} color="#64748b" />
        </TouchableOpacity>
      </View>

      {isOwner ? (
        <>
          <FormField label="Name" value={name} onChangeText={value => { setName(value); clearError('name'); }} error={errors.name} />
          {fund.fundType !== 'HELD_FOR_ME' && (
            <FormField label="Float amount" value={target} onChangeText={value => { setTarget(value); clearError('target'); }} keyboardType="decimal-pad" placeholder="Optional" error={errors.target} />
          )}
          <TouchableOpacity accessibilityRole="button" onPress={saveDetails} className="rounded-xl py-3 items-center bg-teal-600 mb-5">
            <Text className="text-white font-bold text-sm">Save</Text>
          </TouchableOpacity>

          {!fund.custodianUid && (
            <View className="mb-4">
              {newCode ? <InviteShareCard code={newCode} ownerName={fund.ownerName} fundName={fund.name} /> : (
                <TouchableOpacity accessibilityRole="button" onPress={onNewCode} className="rounded-xl py-3 items-center bg-slate-100 dark:bg-slate-800 mb-2">
                  <Text className="text-slate-900 dark:text-white font-bold text-sm">Get a new invite code</Text>
                </TouchableOpacity>
              )}
              {fund.linkStatus === 'PENDING' && (
                <TouchableOpacity accessibilityRole="button" onPress={() => onAction(() => SharedFundService.cancelInvite(fund.id), 'Invite cancelled.')} className="rounded-xl py-3 items-center mt-2">
                  <Text className="text-rose-600 dark:text-rose-400 font-bold text-sm">Cancel the invite</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {fund.linkStatus === 'ACCEPTED' && (
            fund.status === 'ACTIVE' ? (
              <TouchableOpacity accessibilityRole="button" onPress={() => confirm('Close this fund?', `${fund.custodianName || 'The custodian'} won't be able to record anything new. History stays, and you can reopen it.`, 'Close fund', () => { onAction(() => SharedFundService.close(fund.id), 'Fund closed.'); onClose(); })} className="rounded-xl py-3 items-center border border-rose-200 dark:border-rose-900">
                <Text className="text-rose-600 dark:text-rose-400 font-bold text-sm">Close fund</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity accessibilityRole="button" onPress={() => { onAction(() => SharedFundService.reopen(fund.id), 'Fund reopened.'); onClose(); }} className="rounded-xl py-3 items-center bg-teal-600">
                <Text className="text-white font-bold text-sm">Reopen fund</Text>
              </TouchableOpacity>
            )
          )}
        </>
      ) : (
        <>
          <Text className="text-slate-500 dark:text-slate-400 text-sm mb-4">
            {fund.ownerName} owns this fund. You can leave it; you will lose access to its history, and your own ledger entries stay as they are.
          </Text>
          {fund.balance !== 0 && (
            <Text className="text-amber-700 dark:text-amber-300 text-xs font-semibold mb-4">
              The fund still shows {fund.balance > 0 ? `${formatCurrency(fund.balance)} held for ${fund.ownerName}` : `${formatCurrency(-fund.balance)} owed to you`}. Settle it before leaving.
            </Text>
          )}
          <TouchableOpacity accessibilityRole="button" onPress={() => confirm('Leave this fund?', `${fund.ownerName} keeps the history. You can't rejoin without a new invite.`, 'Leave', () => { onAction(() => SharedFundService.leave(fund.id), 'You left the fund.'); onLeft(); })} className="rounded-xl py-3 items-center border border-rose-200 dark:border-rose-900">
            <Text className="text-rose-600 dark:text-rose-400 font-bold text-sm">Leave fund</Text>
          </TouchableOpacity>
        </>
      )}
    </FormSheet>
  );
}
